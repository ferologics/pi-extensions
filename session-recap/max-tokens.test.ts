import { afterEach, expect, it, vi } from "vitest";
import { exchange, loadRecap, testModel, userEntry } from "./test-harness.js";

afterEach(() => {
    vi.restoreAllMocks();
});

// pi-ai caps max_tokens to what fits in the recap model's context window, estimating the request from the last
// assistant message's usage. In a session larger than that window, the main session's usage would cap the recap
// at one token, and the recap model would stop before writing anything.
it("gives the recap its full output budget in a session larger than the recap model's context window", async () => {
    let body: { max_tokens?: number } | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return new Response(
            JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "stop" } }),
            {
                status: 400,
                headers: { "content-type": "application/json" },
            },
        );
    });
    const [, answer] = exchange as any[];
    const largeSessionAnswer = {
        ...answer,
        message: {
            ...answer.message,
            stopReason: "stop",
            usage: { input: 0, output: 500, cacheRead: 350_000, cacheWrite: 0, totalTokens: 350_500 },
        },
    };
    const session = loadRecap({
        model: { ...testModel("anthropic-messages", "anthropic", "claude-haiku-4-5"), contextWindow: 200_000 },
        branch: [userEntry("Please fix the bridge integration."), largeSessionAnswer],
    });

    await session.recap();

    expect(body?.max_tokens).toBe(256);
});
