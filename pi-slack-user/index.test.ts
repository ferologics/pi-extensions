import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import piSlackUserExtension from "./index.js";

interface RegisteredTool {
    execute: (
        toolCallId: string,
        params: { url: string; text: string },
        signal: AbortSignal | undefined,
        onUpdate: undefined,
        ctx: {
            hasUI: boolean;
            ui: {
                confirm: (title: string, message: string) => Promise<boolean>;
            };
        },
    ) => Promise<{ content: Array<{ type: string; text: string }>; details: Record<string, unknown> }>;
}

const originalToken = process.env.SLACK_USER_TOKEN;

function loadPostTool(): RegisteredTool {
    const tools = new Map<string, RegisteredTool>();
    const pi = {
        registerTool(tool: RegisteredTool & { name: string }) {
            tools.set(tool.name, tool);
        },
        registerCommand() {},
    };

    piSlackUserExtension(pi as never);
    const tool = tools.get("slack_post_reply_url");
    if (!tool) throw new Error("slack_post_reply_url was not registered");
    return tool;
}

beforeEach(() => {
    process.env.SLACK_USER_TOKEN = "xoxp-test-token";
});

afterEach(() => {
    vi.unstubAllGlobals();
    if (originalToken === undefined) {
        delete process.env.SLACK_USER_TOKEN;
    } else {
        process.env.SLACK_USER_TOKEN = originalToken;
    }
});

describe("slack_post_reply_url safety", () => {
    it("does not call Slack when confirmation is declined", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        const tool = loadPostTool();
        const confirm = vi.fn().mockResolvedValue(false);

        const result = await tool.execute(
            "call-1",
            {
                url: "https://example.slack.com/archives/C123/p1700000000123456",
                text: "Exact reply",
            },
            undefined,
            undefined,
            { hasUI: true, ui: { confirm } },
        );

        expect(confirm).toHaveBeenCalledWith(
            "Post Slack reply?",
            expect.stringContaining("Exact message:\nExact reply"),
        );
        expect(fetchMock).not.toHaveBeenCalled();
        expect(result.details).toEqual({ posted: false });
    });

    it("refuses to post when interactive confirmation is unavailable", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        const tool = loadPostTool();

        await expect(
            tool.execute(
                "call-1",
                {
                    url: "https://example.slack.com/archives/C123/p1700000000123456",
                    text: "Exact reply",
                },
                undefined,
                undefined,
                { hasUI: false, ui: { confirm: vi.fn() } },
            ),
        ).rejects.toThrow("interactive UI confirmation");
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
