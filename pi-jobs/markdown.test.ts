import { describe, expect, it } from "vitest";
import { reflow } from "./markdown.js";

describe("reflow", () => {
    it("joins hard-wrapped paragraph and list lines", () => {
        const text =
            "Check the page and look for an entry. If it is not on the\nfront page, search.\n\n- first item that\n  wraps\n- second";
        expect(reflow(text)).toBe(
            "Check the page and look for an entry. If it is not on the front page, search.\n\n- first item that wraps\n- second",
        );
    });

    it("keeps headings, quotes, tables, and fenced code as written", () => {
        const text = "# Title\nBody line\n> quote\n| a | b |\n| - | - |\n```\ncode one\ncode two\n```\nafter";
        expect(reflow(text)).toBe(text);
    });
});
