const FENCE = /^\s*(```|~~~)/;
/** Lines that start their own Markdown block: list items, headings, quotes, table rows, indented code. */
const BLOCK_START = /^\s*([-*+]\s|\d+[.)]\s|#{1,6}\s|>|\|)|^( {4}|\t)/;
/** Lines that never take a following line into them. */
const STANDALONE = /^\s*(#{1,6}\s|\|)/;

/**
 * Join hard-wrapped lines inside paragraphs and list items, so text written at one width rewraps cleanly at
 * another. Blank lines, block starts, and fenced code keep their line breaks.
 */
export function reflow(markdown: string): string {
    const lines: string[] = [];
    let inFence = false;
    for (const line of markdown.split("\n")) {
        if (FENCE.test(line)) {
            inFence = !inFence;
            lines.push(line);
            continue;
        }
        const previous = lines.at(-1);
        const continues =
            !inFence &&
            previous !== undefined &&
            previous.trim() !== "" &&
            line.trim() !== "" &&
            !BLOCK_START.test(line) &&
            !FENCE.test(previous) &&
            !STANDALONE.test(previous);
        if (continues) lines[lines.length - 1] = `${previous.trimEnd()} ${line.trim()}`;
        else lines.push(line);
    }
    return lines.join("\n");
}
