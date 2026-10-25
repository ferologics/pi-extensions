import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { describeBlock, extractBlocks, latestResponseBlocks } from "./blocks.js";

function message(role: "user" | "assistant", text: string): SessionEntry {
    const content = role === "user" ? text : [{ type: "text", text }];
    return { type: "message", message: { role, content } } as unknown as SessionEntry;
}

describe("extractBlocks", () => {
    it("returns quote contents as raw Markdown without quote markers", () => {
        const markdown = [
            "Here is the prompt:",
            "",
            "> The episodes are **published**.",
            ">",
            "> 1. **Covers:** same design",
            ">    - keep the episode line",
            "",
            "Done.",
        ].join("\n");

        expect(extractBlocks(markdown)).toEqual([
            {
                kind: "quote",
                text: "The episodes are **published**.\n\n1. **Covers:** same design\n   - keep the episode line",
            },
        ]);
    });

    it("returns fenced code without fences, including blocks nested in list items", () => {
        const markdown = [
            "```markdown",
            "# Handoff",
            "```",
            "",
            "1. Run this:",
            "   ```bash",
            "   pbcopy < notes.md",
            "   ```",
        ].join("\n");

        expect(extractBlocks(markdown)).toEqual([
            { kind: "code", lang: "markdown", text: "# Handoff" },
            { kind: "code", lang: "bash", text: "pbcopy < notes.md" },
        ]);
    });
});

describe("latestResponseBlocks", () => {
    it("reads only the assistant messages after the last user message, newest first", () => {
        const branch = [
            message("user", "first"),
            message("assistant", "> old quote"),
            message("user", "second"),
            message("assistant", "> first quote\n\n```sh\nls\n```"),
            message("assistant", "> final quote"),
        ];

        expect(latestResponseBlocks(branch).map((block) => block.text)).toEqual(["final quote", "ls", "first quote"]);
    });
});

describe("describeBlock", () => {
    it("labels the block kind, line count, and first non-empty line", () => {
        expect(describeBlock({ kind: "code", lang: "bash", text: "\necho hi\necho bye" })).toBe(
            "code:bash · 3 lines · echo hi",
        );
    });
});
