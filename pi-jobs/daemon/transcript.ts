import type { Message } from "@earendil-works/pi-ai";
import { AssistantEntry, type EntryRecord, ResetEntry, ToolResultEntry, UserEntry } from "@earendil-works/pi-durable";
import type { TranscriptItem } from "../api.js";

/** Per-item cap, so one huge tool result does not swamp the transcript. */
const MAX_ITEM_CHARS = 20_000;

function capped(text: string): string {
    return text.length > MAX_ITEM_CHARS ? `${text.slice(0, MAX_ITEM_CHARS)}\n[truncated]` : text;
}

function textOf(content: string | readonly { type: string; text?: string }[]): string {
    if (typeof content === "string") return content;
    return content
        .map((part) => (part.type === "text" ? (part.text ?? "") : `[${part.type}]`))
        .join("")
        .trim();
}

function messageItems(message: Message, userType: "handoff" | "user"): TranscriptItem[] {
    switch (message.role) {
        case "user":
            return [{ type: userType, text: capped(textOf(message.content)) }];
        case "assistant": {
            const items: TranscriptItem[] = [];
            for (const part of message.content) {
                if (part.type === "text" && part.text.trim())
                    items.push({ type: "assistant", text: capped(part.text) });
                if (part.type === "toolCall") {
                    items.push({ type: "tool_call", tool: part.name, text: JSON.stringify(part.arguments, null, 2) });
                }
            }
            return items;
        }
        case "toolResult":
            return [
                {
                    type: "tool_result",
                    tool: message.toolName,
                    text: capped(textOf(message.content)),
                    isError: message.isError,
                },
            ];
        default:
            return [];
    }
}

/** The steps an entry contributes to a run transcript; system prompt and bookkeeping entries contribute none. */
export function entryItems(entry: EntryRecord): TranscriptItem[] {
    const kinds = [ResetEntry.kind, UserEntry.kind, AssistantEntry.kind, ToolResultEntry.kind];
    if (!kinds.includes(entry.kind)) return [];
    const userType = entry.kind === ResetEntry.kind ? "handoff" : "user";
    return (entry.model ?? []).flatMap((message) => messageItems(message, userType));
}
