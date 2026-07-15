import { describe, expect, it, vi } from "vitest";
import { type FetchLike, type SlackApiError, SlackUserClient } from "./slack.js";
import { parseSlackPermalink } from "./url.js";

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

describe("SlackUserClient", () => {
    it("reads and paginates a thread with the user bearer token", async () => {
        const fetchMock = vi.fn<FetchLike>();
        fetchMock
            .mockResolvedValueOnce(
                jsonResponse({
                    ok: true,
                    messages: [{ user: "U123", text: "First", ts: "1700000000.123456" }],
                    has_more: true,
                    response_metadata: { next_cursor: "next" },
                }),
            )
            .mockResolvedValueOnce(
                jsonResponse({
                    ok: true,
                    messages: [{ user: "U123", text: "Second", ts: "1700000001.123456" }],
                    has_more: false,
                    response_metadata: { next_cursor: "" },
                }),
            )
            .mockResolvedValueOnce(
                jsonResponse({
                    ok: true,
                    user: {
                        id: "U123",
                        name: "alice",
                        profile: { display_name: "Alice" },
                    },
                }),
            );

        const client = new SlackUserClient("xoxp-test-token", fetchMock);
        const target = parseSlackPermalink("https://example.slack.com/archives/C123/p1700000000123456");
        const thread = await client.readThread(target, 100);

        expect(thread.messages.map((message) => message.text)).toEqual(["First", "Second"]);
        expect(thread.users.get("U123")).toBe("Alice");
        expect(fetchMock).toHaveBeenCalledTimes(3);

        const firstInit = fetchMock.mock.calls[0]?.[1];
        expect(firstInit?.headers).toMatchObject({ Authorization: "Bearer xoxp-test-token" });
        const firstBody = new URLSearchParams(String(firstInit?.body));
        expect({
            channel: firstBody.get("channel"),
            ts: firstBody.get("ts"),
            limit: firstBody.get("limit"),
        }).toEqual({
            channel: "C123",
            ts: "1700000000.123456",
            limit: "100",
        });
    });

    it("posts a plain user-context reply without identity customization", async () => {
        const fetchMock = vi
            .fn<FetchLike>()
            .mockResolvedValue(jsonResponse({ ok: true, channel: "C123", ts: "1700000010.654321" }));
        const client = new SlackUserClient("xoxp-test-token", fetchMock);
        const target = parseSlackPermalink("https://example.slack.com/archives/C123/p1700000000123456");

        await expect(client.postReply(target, "Ship it")).resolves.toEqual({
            channel: "C123",
            ts: "1700000010.654321",
        });

        const [url, init] = fetchMock.mock.calls[0] ?? [];
        expect(url).toBe("https://slack.com/api/chat.postMessage");
        const postBody = new URLSearchParams(String(init?.body));
        expect({
            channel: postBody.get("channel"),
            thread_ts: postBody.get("thread_ts"),
            text: postBody.get("text"),
        }).toEqual({
            channel: "C123",
            thread_ts: "1700000000.123456",
            text: "Ship it",
        });
    });

    it("reports missing Slack scopes without exposing the token", async () => {
        const fetchMock = vi.fn<FetchLike>().mockResolvedValue(
            jsonResponse({
                ok: false,
                error: "missing_scope",
                needed: "channels:history",
                provided: "chat:write",
            }),
        );
        const client = new SlackUserClient("xoxp-secret", fetchMock);
        const target = parseSlackPermalink("https://example.slack.com/archives/C123/p1700000000123456");

        await expect(client.readThread(target, 100)).rejects.toEqual(
            expect.objectContaining<Partial<SlackApiError>>({
                message: "Slack conversations.replies failed: missing_scope (needed: channels:history)",
            }),
        );

        await expect(client.readThread(target, 100)).rejects.not.toThrow("xoxp-secret");
    });
});
