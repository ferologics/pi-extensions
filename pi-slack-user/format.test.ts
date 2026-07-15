import { describe, expect, it } from "vitest";
import { formatSlackThread } from "./format.js";
import type { SlackThread } from "./slack.js";
import { parseSlackPermalink } from "./url.js";

describe("Slack thread formatting", () => {
    it("hydrates authors, mentions, links, and file metadata", () => {
        const target = parseSlackPermalink("https://example.slack.com/archives/C123/p1700000000123456");
        const thread: SlackThread = {
            messages: [
                {
                    user: "U123",
                    text: "Hi <@U456>, see <https://example.com|the doc> &amp; reply.",
                    ts: "1700000000.123456",
                    files: [
                        {
                            id: "F123",
                            name: "design.png",
                            mimetype: "image/png",
                            permalink: "https://example.slack.com/files/U123/F123/design.png",
                        },
                    ],
                },
            ],
            users: new Map([
                ["U123", "Alice"],
                ["U456", "Bob"],
            ]),
            truncatedByMessageLimit: false,
        };

        const result = formatSlackThread(target, thread);

        expect(result.outputTruncated).toBe(false);
        expect(result.text).toContain("## Alice — 2023-11-14 22:13:20 UTC");
        expect(result.text).toContain("Hi @Bob, see [the doc](https://example.com) & reply.");
        expect(result.text).toContain("📎 design.png (F123 · image/png)");
    });
});
