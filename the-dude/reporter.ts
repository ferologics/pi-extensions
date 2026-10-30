// Runs in every interactive Pi session: publishes what the board shows and listens for messages and
// priority changes. Adds no prompt text and no tools.

import type { Server } from "node:net";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { FOCUS_DISABLE, FOCUS_ENABLE, FocusParser } from "./focus.js";
import { lookupTerminalId } from "./ghostty.js";
import { type LiveSession, liveDir, type Priority, removeLive, socketPath, writeLive } from "./live.js";
import { type Project, projectOf } from "./project.js";
import { MESSAGE_TYPE, messageContent } from "./message.js";
import { close, listen, type Request, type Response } from "./socket.js";
import { StatusTracker } from "./status.js";

const PRIORITY_TYPE = "the-dude-priority";
const RECAP_TYPE = "session-recap";
const SESSION_POLL_MS = 5000;
const LABEL_CHARS = 120;
/** Messages that may start or continue runs in a row without input from you, so two sessions can't keep each other busy. */
const MESSAGE_RUN_LIMIT = 3;

/** Shared with the rest of the extension: what this session publishes, and whether the board is open here. */
export interface Reporter {
    current(): LiveSession | undefined;
    setBoardOpen(open: boolean): void;
}

interface ProcessState {
    terminalId?: Promise<string | undefined>;
}

// Once per process, not per extension runtime: /reload and /new replace the runtime but not the terminal.
function processState(): ProcessState {
    const key = Symbol.for("the-dude-reporter");
    const holder = globalThis as unknown as Record<symbol, ProcessState | undefined>;
    const existing = holder[key];
    const state: ProcessState = existing ?? {};
    if (!existing) {
        holder[key] = state;
        const dir = liveDir();
        process.on("exit", () => removeLive(dir, process.pid));
    }
    if (!state.terminalId) {
        const lookup = lookupTerminalId();
        state.terminalId = lookup;
        // Keep only a successful lookup, so the next session start or /reload tries again.
        lookup.catch(() => {
            if (state.terminalId === lookup) state.terminalId = undefined;
        });
    }
    return state;
}

function firstLine(text: string): string {
    const line = text.split("\n").find((candidate) => candidate.trim()) ?? "";
    return line.trim().slice(0, LABEL_CHARS);
}

function userText(entry: SessionEntry): string | undefined {
    if (entry.type !== "message" || entry.message.role !== "user") return undefined;
    const content = entry.message.content;
    if (typeof content === "string") return content;
    return content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
}

function latestCustom<T>(branch: SessionEntry[], customType: string): { data: T; timestamp: string } | undefined {
    for (let index = branch.length - 1; index >= 0; index--) {
        const entry = branch[index]!;
        if (entry.type === "custom" && entry.customType === customType) {
            return { data: entry.data as T, timestamp: entry.timestamp };
        }
    }
    return undefined;
}

function lastError(messages: readonly unknown[]): string | undefined {
    for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index] as Partial<AssistantMessage>;
        if (message?.role !== "assistant") continue;
        return message.stopReason === "error" ? firstLine(message.errorMessage ?? "") || "error" : undefined;
    }
    return undefined;
}

export function registerReporter(pi: ExtensionAPI): Reporter {
    const dir = liveDir();
    let ctx: ExtensionContext | undefined;
    let tracker = new StatusTracker();
    let base: Omit<LiveSession, "status" | "statusSince" | "statusDetail" | "updatedAt"> | undefined;
    let server: Server | undefined;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let focusListener: ((chunk: Buffer) => void) | undefined;
    let boardOpen = false;
    let pendingPriority: { priority: Priority | null } | undefined;
    let messageRuns = 0;
    let published = "";
    /** Set while writes fail, so a lasting failure is reported once. */
    let writeFailing = false;
    /** First line of the session's first prompt: the label whenever the session has no name. */
    let firstPrompt = "";

    const current = (): LiveSession | undefined => {
        if (!base) return undefined;
        return {
            ...base,
            status: tracker.status,
            statusSince: new Date(tracker.since).toISOString(),
            ...(tracker.detail ? { statusDetail: tracker.detail } : {}),
            updatedAt: new Date().toISOString(),
        };
    };

    const publish = () => {
        const session = current();
        if (!session) return;
        const { updatedAt: _, ...comparable } = session;
        const key = JSON.stringify(comparable);
        if (key === published) return;
        // Report instead of throwing: the focus listener and the poll timer call this outside Pi's event handlers,
        // where a throw would crash Pi. Unpublished state is written again on the next change or poll.
        try {
            writeLive(dir, session);
        } catch (error) {
            if (!writeFailing) {
                const reason = error instanceof Error ? error.message : String(error);
                ctx?.ui.notify(`the-dude: can't publish this session to the board: ${reason}`, "error");
            }
            writeFailing = true;
            return;
        }
        published = key;
        writeFailing = false;
    };

    /** Re-read what lives in the session file: label, priority and the latest recap. */
    const readSession = () => {
        if (!ctx || !base) return;
        const branch = ctx.sessionManager.getBranch();
        if (!firstPrompt) firstPrompt = firstLine(branch.map(userText).find((text) => text?.trim()) ?? "");
        base.label = ctx.sessionManager.getSessionName()?.slice(0, LABEL_CHARS) || firstPrompt;
        if (!pendingPriority) {
            const saved = latestCustom<{ priority: Priority | null }>(branch, PRIORITY_TYPE)?.data.priority;
            if (saved === null || saved === undefined) delete base.priority;
            else base.priority = saved;
        }
        const recap = latestCustom<{ text?: unknown }>(branch, RECAP_TYPE);
        if (recap && typeof recap.data?.text === "string") base.recap = { text: recap.data.text, at: recap.timestamp };
    };

    const setPriority = (priority: Priority | null) => {
        if (!base) return;
        if (priority === null) delete base.priority;
        else base.priority = priority;
        // Never between a running turn's own entries: save it once the run settles.
        if (tracker.isRunning) pendingPriority = { priority };
        else pi.appendEntry(PRIORITY_TYPE, { priority });
        publish();
    };

    const deliver = (request: Extract<Request, { type: "send" }>, live: ExtensionContext): Response => {
        const message = {
            customType: MESSAGE_TYPE,
            content: messageContent(request.message, request.from),
            display: true,
            details: { from: request.from },
        };
        // Past the limit, a busy session shows the message at the end of its turn, an idle one right away; neither
        // starts or continues a run on it.
        if (messageRuns >= MESSAGE_RUN_LIMIT) {
            pi.sendMessage(message, { triggerTurn: false });
            return {
                ok: true,
                data: "delivered without starting or continuing a run: too many messages in a row without input from the user",
            };
        }
        messageRuns++;
        if (!live.isIdle()) {
            pi.sendMessage(message, { triggerTurn: true, deliverAs: request.mode === "steer" ? "steer" : "followUp" });
            return { ok: true, data: request.mode === "steer" ? "steered" : "queued as a follow-up" };
        }
        pi.sendMessage(message, { triggerTurn: true });
        return { ok: true, data: "delivered; it started a run" };
    };

    const handle = (request: Request): Response => {
        const live = ctx;
        if (!live) return { ok: false, error: "session not ready" };
        if (request.type === "priority") {
            setPriority(request.priority);
            return { ok: true };
        }
        return deliver(request, live);
    };

    const attachFocus = () => {
        if (focusListener || !process.stdin.isTTY || !process.stdout.isTTY) return;
        const parser = new FocusParser();
        focusListener = (chunk: Buffer) => {
            for (const event of parser.feed(chunk.toString("binary"))) {
                if (event === "in") tracker.focusIn();
                else tracker.focusOut();
                publish();
            }
        };
        process.stdin.on("data", focusListener);
        try {
            process.stdout.write(FOCUS_ENABLE);
        } catch {}
    };

    const detachFocus = () => {
        if (!focusListener) return;
        process.stdin.off("data", focusListener);
        focusListener = undefined;
        try {
            process.stdout.write(FOCUS_DISABLE);
        } catch {}
    };

    const stop = async () => {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = undefined;
        detachFocus();
        if (server) await close(server, socketPath(dir, process.pid));
        server = undefined;
        removeLive(dir, process.pid);
        base = undefined;
        ctx = undefined;
        published = "";
    };

    pi.on("session_start", async (_event, startCtx) => {
        // pi-subagent children keep their own inbox until they move onto this mechanism.
        if (startCtx.mode !== "tui" || process.env.PI_SUBAGENT_RUN_DIR) return;
        ctx = startCtx;
        tracker = new StatusTracker(!startCtx.isIdle());
        pendingPriority = undefined;
        messageRuns = 0;
        firstPrompt = "";
        const now = new Date().toISOString();
        const cwd = startCtx.sessionManager.getCwd();
        base = {
            v: 1,
            pid: process.pid,
            sessionId: startCtx.sessionManager.getSessionId(),
            sessionFile: startCtx.sessionManager.getSessionFile(),
            cwd,
            project: { key: cwd, name: cwd.split("/").pop() || cwd },
            label: "",
            model: startCtx.model ? `${startCtx.model.provider}/${startCtx.model.id}` : undefined,
            startedAt: now,
        };
        readSession();
        publish();
        attachFocus();
        pollTimer = setInterval(() => {
            readSession();
            publish();
        }, SESSION_POLL_MS);

        const session = base;
        const state = processState();
        void projectOf(cwd).then((project: Project) => {
            if (base !== session) return;
            session.project = project;
            publish();
        });
        state.terminalId!.then(
            (terminalId) => {
                if (base !== session || !terminalId) return;
                session.terminalId = terminalId;
                publish();
            },
            (error: unknown) => {
                if (base !== session) return;
                const reason = error instanceof Error ? error.message : String(error);
                startCtx.ui.notify(
                    `the-dude: can't find this session's Ghostty terminal, so the board can't group it under its window or jump to it (/reload retries): ${reason}`,
                    "warning",
                );
            },
        );
        try {
            server = await listen(socketPath(dir, process.pid), handle);
        } catch (error) {
            startCtx.ui.notify(
                `the-dude: no message socket: ${error instanceof Error ? error.message : error}`,
                "warning",
            );
        }
    });

    pi.on("session_shutdown", () => stop());

    pi.on("session_info_changed", () => {
        readSession();
        publish();
    });

    pi.on("model_select", (event) => {
        if (!base) return;
        base.model = `${event.model.provider}/${event.model.id}`;
        publish();
    });

    pi.on("input", (event) => {
        if (event.source === "extension") return;
        messageRuns = 0;
        tracker.input();
        if (!firstPrompt && !event.text.trimStart().startsWith("/")) {
            firstPrompt = firstLine(event.text);
            readSession();
        }
        publish();
    });

    pi.on("agent_start", () => {
        tracker.runStarted();
        publish();
    });

    pi.on("agent_end", (event) => {
        tracker.runEnded(lastError(event.messages));
    });

    pi.on("agent_settled", (event) => {
        tracker.runSettled(event.aborted);
        if (pendingPriority) {
            pi.appendEntry(PRIORITY_TYPE, pendingPriority);
            pendingPriority = undefined;
        }
        readSession();
        publish();
    });

    pi.on("tool_execution_start", () => tracker.toolStarted());

    pi.on("tool_execution_end", () => tracker.toolEnded());

    pi.on("ui_prompt_start", (event) => {
        // The board's own overlay goes through the same dialog API; it is not the session asking you.
        if (boardOpen) return;
        tracker.dialogOpened(event.title ?? event.kind);
        publish();
    });

    pi.on("ui_prompt_end", () => {
        tracker.dialogClosed();
        publish();
    });

    return {
        current,
        setBoardOpen: (open) => {
            boardOpen = open;
        },
    };
}
