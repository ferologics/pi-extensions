import { open } from "node:fs/promises";
import type { FileEntry, SessionEntry } from "@earendil-works/pi-coding-agent";
import { MESSAGE_HEADER, MESSAGE_TYPE, senderLine } from "./message.js";
import type { Sender } from "./socket.js";

const USER_TURNS = 2;
const USER_CHARS = 1500;
const TEXT_CHARS = 4000;
/** Session files reach tens of MB; the peek reads this much of the end first and widens only when it must. */
const TAIL_BYTES = 512 * 1024;

type Content = string | { type: string; text?: string; name?: string; arguments?: unknown }[];

/** The current branch: from the last entry back to the root, or to the first entry missing from `entries`. */
export function currentBranch(entries: FileEntry[]): SessionEntry[] {
    const byId = new Map<string, SessionEntry>();
    let leaf: SessionEntry | undefined;
    for (const entry of entries) {
        if (entry.type === "session") continue;
        byId.set(entry.id, entry);
        leaf = entry;
    }
    const branch: SessionEntry[] = [];
    for (let entry = leaf; entry; entry = entry.parentId ? byId.get(entry.parentId) : undefined) {
        branch.push(entry);
    }
    return branch.reverse();
}

function clip(text: string, max: number): string {
    return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function textOf(content: Content): string {
    if (typeof content === "string") return content;
    return content
        .flatMap((block) => (block.type === "text" && block.text ? [block.text] : []))
        .join("\n")
        .trim();
}

/** One line for a tool call: its name and the start of its main argument. */
function toolCallLine(name: string, args: unknown): string {
    const input = (args ?? {}) as Record<string, unknown>;
    const main = input.command ?? input.path ?? input.query ?? input.url ?? input.pattern ?? Object.values(input)[0];
    const summary = typeof main === "string" ? main.split("\n")[0]! : main === undefined ? "" : JSON.stringify(main);
    return `\`→ ${name}${summary ? `: ${clip(summary, 100).replaceAll("`", "'")}` : ""}\``;
}

/** Markdown blocks for the end of a session: its last few user turns with replies and tool calls. */
export function tailParts(branch: SessionEntry[]): string[] {
    let start = 0;
    let turns = 0;
    for (let index = branch.length - 1; index >= 0; index--) {
        const entry = branch[index]!;
        if (entry.type === "message" && entry.message.role === "user" && ++turns === USER_TURNS) {
            start = index;
            break;
        }
    }
    const parts: string[] = [];
    for (const entry of branch.slice(start)) {
        if (entry.type === "compaction") parts.push("*(earlier conversation compacted)*");
        if (entry.type === "custom_message" && entry.display) {
            const text = textOf(entry.content as Content);
            if (entry.customType === MESSAGE_TYPE) {
                const from = senderLine((entry.details as { from?: Sender } | undefined)?.from);
                parts.push(`**✉ Message from ${from}:** ${clip(text.replace(MESSAGE_HEADER, ""), USER_CHARS)}`);
            } else parts.push(`*${entry.customType}:* ${clip(text, USER_CHARS)}`);
        }
        if (entry.type !== "message") continue;
        const message = entry.message;
        if (message.role === "user") {
            parts.push(`**You:** ${clip(textOf(message.content as Content), USER_CHARS)}`);
        } else if (message.role === "assistant") {
            const lines: string[] = [];
            for (const block of message.content) {
                if (block.type === "text" && block.text.trim()) lines.push(clip(block.text.trim(), TEXT_CHARS));
                if (block.type === "toolCall") lines.push(toolCallLine(block.name, block.arguments));
            }
            if (message.stopReason === "error")
                lines.push(`**Error:** ${message.errorMessage ?? "the request failed"}`);
            if (lines.length > 0) parts.push(lines.join("\n\n"));
        } else if (message.role === "toolResult" && message.isError) {
            parts.push(`\`✗ ${message.toolName} failed\``);
        }
    }
    return parts;
}

/** Entries from the last `bytes` of a session file, skipping the line cut in half at the start. */
async function readEntries(sessionFile: string, bytes: number): Promise<{ entries: FileEntry[]; whole: boolean }> {
    const file = await open(sessionFile, "r");
    try {
        const { size } = await file.stat();
        const start = Math.max(0, size - bytes);
        const buffer = Buffer.alloc(size - start);
        await file.read(buffer, 0, buffer.length, start);
        const lines = buffer.toString("utf8").split("\n");
        if (start > 0) lines.shift();
        const entries: FileEntry[] = [];
        for (const line of lines) {
            try {
                if (line.trim()) entries.push(JSON.parse(line) as FileEntry);
            } catch {}
        }
        return { entries, whole: start === 0 };
    } finally {
        await file.close();
    }
}

function userTurns(branch: SessionEntry[]): number {
    return branch.filter((entry) => entry.type === "message" && entry.message.role === "user").length;
}

export async function readTail(sessionFile: string): Promise<string[]> {
    for (let bytes = TAIL_BYTES; ; bytes *= 4) {
        const { entries, whole } = await readEntries(sessionFile, bytes);
        const branch = currentBranch(entries);
        if (whole || userTurns(branch) >= USER_TURNS) {
            const parts = tailParts(branch);
            return parts.length > 0 ? parts : ["*(nothing yet)*"];
        }
    }
}
