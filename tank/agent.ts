// Tank himself: in sessions whose cwd is Tank's home, register his tools and, when his notes are on, put NOTES.md in
// his prompt. Every other session gets none of this.

import { StringEnum, Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ago } from "./board.js";
import { editNotes, NOTES_FILE, readNotes, readTankConfig, type TankConfig } from "./home.js";
import { type LiveSession, listLive, liveDir, resolveTarget, socketPath } from "./live.js";
import { readTail } from "./peek.js";
import { focusTerminal, type RexSession, readLayout } from "./rex.js";
import { request } from "./socket.js";

const READ_TURNS = 3;
const READ_CHARS = 40_000;

function sessionLines(session: LiveSession, place: string, now: number): string[] {
    const facts = [
        session.project.name,
        `"${session.label || "(new session)"}"`,
        `${session.status} ${ago(session.statusSince, now)}`,
        ...(session.statusDetail ? [session.statusDetail] : []),
        ...(session.priority === undefined ? [] : [`p${session.priority}`]),
        ...(session.tank ? ["this is you"] : []),
        ...(place ? [place] : []),
    ];
    return [
        `- ${session.sessionId} · ${facts.join(" · ")}`,
        ...(session.recap ? [`  recap: ${session.recap.text}`] : []),
        `  cwd: ${session.cwd} · model: ${session.model ?? "unknown"} · file: ${session.sessionFile ?? "(not saved yet)"}`,
    ];
}

/** Every live session, by Rex session in sidebar order and tab order, then the ones outside Rex. */
export function describeSessions(sessions: LiveSession[], layout: RexSession[] | undefined, now = Date.now()): string {
    const placed = new Set<number>();
    const lines: string[] = [];
    for (const rexSession of layout ?? []) {
        const found: string[] = [];
        rexSession.tabs.forEach((tab, tabIndex) => {
            for (const block of tab.blocks) {
                const session = sessions.find((candidate) => candidate.terminalId === block);
                if (!session) continue;
                placed.add(session.pid);
                found.push(...sessionLines(session, `tab ${tabIndex + 1}`, now));
            }
        });
        if (found.length > 0) lines.push(`Rex session "${rexSession.label}":`, ...found);
    }
    const rest = sessions.filter((session) => !placed.has(session.pid));
    if (rest.length > 0) {
        lines.push("Not in Rex:", ...rest.flatMap((session) => sessionLines(session, "", now)));
    }
    return lines.join("\n") || "No live Pi sessions.";
}

function text(value: string) {
    return { content: [{ type: "text" as const, text: value }], details: undefined };
}

function findSession(wanted: string): LiveSession {
    const found = resolveTarget(listLive(liveDir()), wanted);
    if (typeof found === "string") throw new Error(found);
    return found;
}

function registerTools(pi: ExtensionAPI, home: string, config: TankConfig): void {
    const targetParam = Type.String({ description: "Session id, or its label (name or first prompt)." });

    pi.registerTool({
        name: "tank_sessions",
        label: "Sessions",
        description:
            "Every live Pi session on this machine by Rex session (a group of tabs in Rex's sidebar) and tab, in sidebar order: session id, project, label, status, priority, recap, cwd, model and session file.",
        promptSnippet: "List every live Pi session by Rex session and tab",
        parameters: Type.Object({}),
        async execute() {
            const sessions = listLive(liveDir());
            try {
                return text(describeSessions(sessions, await readLayout()));
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                return text(`Can't read Rex's sessions (${reason}).\n${describeSessions(sessions, undefined)}`);
            }
        },
    });

    pi.registerTool({
        name: "tank_read",
        label: "Read Session",
        description:
            "The end of a live session's transcript: its last user turns with replies and tool calls. For older history, read or grep its session file (JSONL).",
        promptSnippet: "Read the end of a live session's transcript",
        parameters: Type.Object({
            target: targetParam,
            turns: Type.Optional(
                Type.Integer({ minimum: 1, maximum: 20, description: `User turns to show (default ${READ_TURNS}).` }),
            ),
        }),
        async execute(_toolCallId, params) {
            const session = findSession(params.target);
            if (!session.sessionFile) throw new Error(`"${session.label}" has no session file yet`);
            let body = (await readTail(session.sessionFile, params.turns ?? READ_TURNS)).join("\n\n");
            if (body.length > READ_CHARS)
                body = `… (earlier part cut; read the file for it)\n\n${body.slice(-READ_CHARS)}`;
            return text(`${session.project.name} · "${session.label}" · ${session.sessionFile}\n\n${body}`);
        },
    });

    pi.registerTool({
        name: "tank_priority",
        label: "Set Priority",
        description:
            "Set a session's priority (p0 highest) or clear it. The session saves it, so it survives restarts.",
        promptSnippet: "Set a session's priority",
        parameters: Type.Object({
            target: targetParam,
            priority: StringEnum(["p0", "p1", "p2", "p3", "none"] as const),
        }),
        async execute(_toolCallId, params) {
            const session = findSession(params.target);
            const priority = params.priority === "none" ? null : (Number(params.priority[1]) as 0 | 1 | 2 | 3);
            const response = await request(socketPath(liveDir(), session.pid), { type: "priority", priority });
            if (!response.ok) throw new Error(response.error);
            return text(
                `"${session.label}" is now ${params.priority === "none" ? "without a priority" : params.priority}`,
            );
        },
    });

    pi.registerTool({
        name: "tank_focus",
        label: "Focus Session",
        description: "Show a session's Rex tab in the app and focus its pane, so the user is looking at it.",
        promptSnippet: "Take the user to a session's terminal",
        parameters: Type.Object({ target: targetParam }),
        async execute(_toolCallId, params) {
            const session = findSession(params.target);
            if (!session.terminalId) throw new Error(`"${session.label}" is not in Rex`);
            await focusTerminal(session.terminalId);
            return text(`The user is now looking at "${session.label}" (${session.project.name}).`);
        },
    });

    if (!config.notes) return;
    pi.registerTool({
        name: "tank_notes",
        label: "Notes",
        description: `Replace ${NOTES_FILE} or a topic note (topics/<name>.md) in your home with new content. Each edit is one git commit.`,
        promptSnippet: "Change your notes",
        parameters: Type.Object({
            file: Type.Optional(Type.String({ description: `${NOTES_FILE} (default) or topics/<name>.md.` })),
            content: Type.String({ description: "The whole new content of the file." }),
            why: Type.String({ description: "One line on what changed and why; the commit message." }),
        }),
        async execute(_toolCallId, params) {
            const file = params.file ?? NOTES_FILE;
            const result = await editNotes(home, file, params.content, params.why);
            if ("unchanged" in result) return text(`${file} already has that content.`);
            return text(`${file} updated (commit ${result.committed}).`);
        },
    });
}

export function registerTank(pi: ExtensionAPI): void {
    let home: string | undefined;
    let notes = false;

    pi.on("session_start", (_event, ctx) => {
        const cwd = ctx.sessionManager.getCwd();
        const config = readTankConfig(cwd);
        home = config ? cwd : undefined;
        notes = config?.notes ?? false;
        if (config) registerTools(pi, cwd, config);
    });

    // NOTES.md is read on every run. Pi sends a changed section as a patch, so on models that take mid-conversation
    // system messages (Opus 5.5, GPT-6) the cached prompt survives an edit.
    pi.on("before_agent_start", (event) => {
        if (!home || !notes) return;
        event.systemPromptOptions.sections = {
            ...event.systemPromptOptions.sections,
            notes: readNotes(home).trim() || "(no notes yet)",
        };
    });
}
