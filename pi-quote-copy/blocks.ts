import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { Marked, type Token } from "@earendil-works/pi-tui";

export interface CopyBlock {
    kind: "quote" | "code";
    lang?: string;
    text: string;
}

const PREVIEW_LENGTH = 72;
const markdownParser = new Marked();

/** Collect quoted and fenced blocks in document order, including ones nested in list items. */
export function extractBlocks(markdown: string): CopyBlock[] {
    const blocks: CopyBlock[] = [];
    collectBlocks(markdownParser.lexer(markdown), blocks);
    return blocks;
}

function collectBlocks(tokens: Token[], blocks: CopyBlock[]): void {
    for (const token of tokens) {
        if (token.type === "blockquote") {
            blocks.push({ kind: "quote", text: token.text });
        } else if (token.type === "code" && token.codeBlockStyle !== "indented") {
            blocks.push({ kind: "code", lang: token.lang || undefined, text: token.text });
        } else if (token.type === "list") {
            for (const item of token.items) collectBlocks(item.tokens, blocks);
        }
    }
}

/** Blocks from the assistant messages after the last user message, newest first. */
export function latestResponseBlocks(branch: SessionEntry[]): CopyBlock[] {
    const blocks: CopyBlock[] = [];

    for (let index = branch.length - 1; index >= 0; index--) {
        const entry = branch[index];
        if (entry.type !== "message") continue;
        if (entry.message.role === "user") break;
        if (entry.message.role !== "assistant") continue;

        const messageBlocks = entry.message.content.flatMap((part) =>
            part.type === "text" ? extractBlocks(part.text) : [],
        );
        blocks.push(...messageBlocks.reverse());
    }

    return blocks;
}

export function describeBlock(block: CopyBlock): string {
    const kind = block.kind === "code" && block.lang ? `code:${block.lang}` : block.kind;
    const lines = block.text.split("\n").length;
    const firstLine = block.text.split("\n").find((line) => line.trim().length > 0) ?? "";
    const preview = firstLine.replace(/\s+/g, " ").trim();
    const truncated = preview.length > PREVIEW_LENGTH ? `${preview.slice(0, PREVIEW_LENGTH - 1)}…` : preview;
    return `${kind} · ${lines} ${lines === 1 ? "line" : "lines"} · ${truncated}`;
}
