import type { Sender } from "./socket.js";

/** Custom message type of messages from other sessions. */
export const MESSAGE_TYPE = "session-message";

/** The first line the model sees, which the transcript and the peek strip because they show the sender themselves. */
export const MESSAGE_HEADER = /^\[Message from [^\n]*\]\n\n/;

/**
 * What the model sees. Labels are often a first prompt ("Call the … tool now"), which reads like an instruction, so
 * the header names only the project and the session id it can reply to.
 */
export function messageContent(message: string, from: Sender | undefined): string {
    const origin = [from?.project && `project ${from.project}`, from?.sessionId && `session ${from.sessionId}`]
        .filter(Boolean)
        .join(", ");
    return `[Message from another Pi session${origin ? ` (${origin})` : ""}]\n\n${message}`;
}

/** How the transcript and the board name a sender. */
export function senderLine(from: Sender | undefined): string {
    const who = [from?.label && `"${from.label}"`, from?.project].filter(Boolean).join(" in ");
    return who || "another session";
}
