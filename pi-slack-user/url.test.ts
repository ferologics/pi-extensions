import { describe, expect, it } from "vitest";
import { buildSlackReplyPermalink, parseSlackPermalink } from "./url.js";

describe("Slack permalink parsing", () => {
    it("parses a root message permalink", () => {
        expect(parseSlackPermalink("https://example.slack.com/archives/C0123ABC456/p1700000000123456")).toEqual({
            originalUrl: "https://example.slack.com/archives/C0123ABC456/p1700000000123456",
            workspaceUrl: "https://example.slack.com",
            channelId: "C0123ABC456",
            messageTs: "1700000000.123456",
            threadTs: "1700000000.123456",
        });
    });

    it("uses thread_ts when the permalink points at a reply", () => {
        const target = parseSlackPermalink(
            "https://example.slack.com/archives/C0123ABC456/p1700009999654321?thread_ts=1700000000.123456&cid=C0123ABC456",
        );

        expect(target.messageTs).toBe("1700009999.654321");
        expect(target.threadTs).toBe("1700000000.123456");
    });

    it("rejects non-Slack URLs and non-message Slack URLs", () => {
        expect(() => parseSlackPermalink("https://example.com/archives/C123/p1700000000123456")).toThrow("slack.com");
        expect(() => parseSlackPermalink("https://example.slack.com/client/T123/C123")).toThrow("/archives/");
    });

    it("builds a permalink for a posted thread reply", () => {
        const target = parseSlackPermalink("https://example.slack.com/archives/C123/p1700000000123456");

        expect(buildSlackReplyPermalink(target, "1700000010.654321")).toBe(
            "https://example.slack.com/archives/C123/p1700000010654321?thread_ts=1700000000.123456&cid=C123",
        );
    });
});
