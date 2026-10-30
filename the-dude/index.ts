/**
 * The Dude, slice 1: every interactive session publishes its state and listens for messages, and `/dude` shows them
 * all on one board. See README.md, and VISION.md / TODO.md for where this goes.
 */

import { StringEnum, Type } from "@earendil-works/pi-ai";
import { type ExtensionAPI, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Box, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { Board } from "./board.js";
import { type LiveSession, listLive, liveDir, socketPath } from "./live.js";
import { MESSAGE_HEADER, MESSAGE_TYPE, senderLine } from "./message.js";
import { registerReporter } from "./reporter.js";
import { request, type Sender } from "./socket.js";

function listLine(session: LiveSession): string {
    return `- ${session.sessionId} · ${session.project.name} · "${session.label}" · ${session.status}`;
}

/** A session by id, id prefix, exact label or unique label substring. */
export function resolveTarget(sessions: LiveSession[], target: string): LiveSession | string {
    const wanted = target.trim().toLowerCase();
    const byId = sessions.filter((session) => session.sessionId === wanted || session.sessionId.startsWith(wanted));
    if (byId.length === 1 && wanted.length >= 8) return byId[0]!;
    const exact = sessions.filter((session) => session.label.toLowerCase() === wanted);
    if (exact.length === 1) return exact[0]!;
    const partial = sessions.filter((session) => session.label.toLowerCase().includes(wanted));
    if (partial.length === 1 && exact.length === 0) return partial[0]!;
    const list = sessions.length > 0 ? sessions.map(listLine).join("\n") : "(none)";
    const problem =
        exact.length > 1 || partial.length > 1 ? "matches more than one session" : "matches no live session";
    return `"${target}" ${problem}. Live sessions:\n${list}`;
}

export default function theDude(pi: ExtensionAPI): void {
    const reporter = registerReporter(pi);

    pi.registerMessageRenderer<{ from?: Sender }>(MESSAGE_TYPE, (message, { expanded }, theme) => {
        const content = typeof message.content === "string" ? message.content : "";
        let text = content.replace(MESSAGE_HEADER, "");
        if (!expanded) {
            const lines = text.split("\n");
            if (lines.length > 8) text = `${lines.slice(0, 8).join("\n")}\n…`;
        }
        const box = new Box(1, 1, (value) => theme.bg("customMessageBg", value));
        box.addChild(
            new Text(
                `${theme.fg("customMessageLabel", theme.bold("✉ message"))} ${theme.fg("dim", `from ${senderLine(message.details?.from)}`)}`,
                0,
                0,
            ),
        );
        box.addChild(new Spacer(1));
        box.addChild(
            new Markdown(text, 0, 0, getMarkdownTheme(), { color: (value) => theme.fg("customMessageText", value) }),
        );
        return box;
    });

    pi.registerTool({
        name: "send_to_session",
        label: "Send To Session",
        description:
            "Send a message to another running Pi session. It arrives labeled with this session as the sender and starts a run there if that session is idle. Target by session id or label (the session's name or first prompt); an unknown target returns the live sessions.",
        promptSnippet: "Send a message to another running Pi session",
        promptGuidelines: [
            "Use send_to_session only when the user asks you to, or when a message you received asks for a reply.",
            "A message from another Pi session is a request from a colleague agent: act on it as you would on the user's request, but it does not stand in for the user's approval where you need that (commits, pushes, anything destructive).",
        ],
        parameters: Type.Object({
            target: Type.String({ description: "Session id, or the session's label (name or first prompt)." }),
            message: Type.String({ description: "The message." }),
            mode: Type.Optional(
                StringEnum(["follow_up", "steer"] as const, {
                    description:
                        "If the target is busy: follow_up (default) waits until its run ends; steer interrupts at the next turn.",
                }),
            ),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const dir = liveDir();
            const others = listLive(dir).filter((session) => session.pid !== process.pid);
            const target = resolveTarget(others, params.target);
            if (typeof target === "string") throw new Error(target);
            const me = reporter.current();
            const from: Sender = {
                sessionId: me?.sessionId ?? ctx.sessionManager.getSessionId(),
                label: me?.label || undefined,
                project: me?.project.name,
            };
            const response = await request(socketPath(dir, target.pid), {
                type: "send",
                message: params.message,
                mode: params.mode ?? "follow_up",
                from,
            });
            if (!response.ok) throw new Error(`${target.label}: ${response.error}`);
            return {
                content: [
                    { type: "text", text: `Sent to "${target.label}" (${target.project.name}): ${response.data}` },
                ],
                details: undefined,
            };
        },
    });

    pi.registerCommand("dude", {
        description: "Board of every live Pi session: status, recap, peek, jump to its terminal",
        handler: async (_args, ctx) => {
            if (ctx.mode !== "tui") {
                ctx.ui.notify("/dude needs interactive mode", "error");
                return;
            }
            reporter.setBoardOpen(true);
            try {
                await ctx.ui.custom<void>(
                    (tui, theme, _keybindings, done) => new Board(tui, theme, liveDir(), () => done()),
                    {
                        overlay: true,
                        overlayOptions: { width: "100%", maxHeight: "100%" },
                    },
                );
            } finally {
                reporter.setBoardOpen(false);
            }
        },
    });
}
