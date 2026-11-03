/**
 * Tank: every interactive session publishes its state and listens for messages, `/tank` shows them all on one
 * board, and sessions in Tank's home are Tank, the meta agent. See README.md, and VISION.md / TODO.md for where this goes.
 */

import { StringEnum, Type } from "@earendil-works/pi-ai";
import { type ExtensionAPI, type ExtensionContext, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Box, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { registerTank } from "./agent.js";
import { Board, TOGGLE_KEY } from "./board.js";
import { listLive, liveDir, resolveTarget, socketPath } from "./live.js";
import { MESSAGE_HEADER, MESSAGE_TYPE, senderLine } from "./message.js";
import { registerReporter } from "./reporter.js";
import { request, type Sender } from "./socket.js";

export default function tank(pi: ExtensionAPI): void {
    const reporter = registerReporter(pi);
    registerTank(pi);

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

    const openBoard = async (ctx: ExtensionContext) => {
        if (ctx.mode !== "tui") {
            ctx.ui.notify("The tank board needs interactive mode", "error");
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
    };

    pi.registerCommand("tank", {
        description: "Board of every live Pi session: status, recap, peek, jump to its terminal",
        handler: (_args, ctx) => openBoard(ctx),
    });

    // Opens the board even while you are typing; the board closes on the same key.
    pi.registerShortcut(TOGGLE_KEY, {
        description: "Show or hide the tank board (Hyper+T)",
        handler: (ctx) => openBoard(ctx),
    });
}
