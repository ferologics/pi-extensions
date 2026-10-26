import { afterEach, describe, expect, it, vi } from "vitest";
import { exchange, loadRecap, recapResponse, stubApi, testModel, userEntry } from "./test-harness.js";

afterEach(() => {
    vi.restoreAllMocks();
});

it("rejects a draft when the projected context changes while it is drafted", async () => {
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
        started = resolve;
    });
    let respond!: () => void;
    const response = new Promise<void>((resolve) => {
        respond = resolve;
    });
    stubApi("recap-projection-validation", async () => {
        started();
        await response;
        return recapResponse("Stale recap.");
    });
    const session = loadRecap({
        model: testModel("recap-projection-validation"),
        branch: [userEntry("Original task")],
    });

    const pending = session.recap();
    await startedPromise;
    session.branch.push({
        ...userEntry("Replacement task"),
        id: "late",
        parentId: session.branch.at(-1)!.id,
        timestamp: new Date().toISOString(),
    } as any);
    respond();
    await pending;

    expect(session.widgets).toEqual([]);
    expect(session.savedRecaps()).toEqual([]);
});

// Recaps must never spend reasoning tokens. `completeSimple` disables thinking for every API by
// omitting `reasoning`, except openai-codex-responses, which then inherits the server-side
// default; that API must get an explicit `reasoningEffort: "none"` through `complete`.
it("turns reasoning off on every API", async () => {
    const codexCalls = stubApi("openai-codex-responses");
    const anthropicCalls = stubApi("anthropic-messages");

    await loadRecap({
        model: testModel("openai-codex-responses", "openai-codex", "gpt-5.6-luna"),
        branch: exchange,
    }).recap();
    await loadRecap({
        // Not the "anthropic" provider: Anthropic sessions draft with Codex. This checks the API path.
        model: testModel("anthropic-messages", "anthropic-api", "claude-haiku-4-5"),
        branch: exchange,
    }).recap();

    expect(codexCalls).toHaveLength(1);
    expect(codexCalls[0]!.kind).toBe("stream");
    expect(codexCalls[0]!.options.reasoningEffort).toBe("none");

    expect(anthropicCalls).toHaveLength(1);
    expect(anthropicCalls[0]!.kind).toBe("streamSimple");
    expect(anthropicCalls[0]!.options.reasoning).toBeUndefined();
    expect(anthropicCalls[0]!.options.reasoningEffort).toBeUndefined();
});

// pi-ai resolves rather than throws when a stream fails, is aborted, or stops at the token cap,
// and hands back the partial message built so far. Only a cleanly stopped response is a recap.
describe("partial responses", () => {
    let nextResponse: unknown;
    stubApi("recap-truncation-test", () => nextResponse);

    async function run(response: unknown) {
        nextResponse = response;
        // Pi installs no console interception: text written there lands mid-frame on the terminal.
        const consoleError = vi.spyOn(console, "error");
        const session = loadRecap({ model: testModel("recap-truncation-test"), branch: exchange });
        await session.recap();
        expect(consoleError).not.toHaveBeenCalled();
        return session;
    }

    it("reports a failed stream instead of drawing its fragment", async () => {
        const session = await run(recapResponse("The", "error", { errorMessage: "socket hang up" }));
        expect(session.widgets).toEqual([]);
        expect(session.savedRecaps()).toEqual([]);
        expect(session.notices).toHaveLength(1);
        expect(session.notices[0]![0]).toMatch(/socket hang up/);
        expect(session.notices[0]![1]).toBe("error");
    });

    it("drops an aborted stream silently", async () => {
        const session = await run(recapResponse("I", "aborted"));
        expect(session.widgets).toEqual([]);
        expect(session.savedRecaps()).toEqual([]);
        expect(session.notices).toEqual([]);
    });

    it("drops a response cut off at the token cap", async () => {
        const session = await run(recapResponse("The next step is to rewrite the bridge adapter so that", "length"));
        expect(session.widgets).toEqual([]);
        expect(session.savedRecaps()).toEqual([]);
        expect(session.notices).toEqual([]);
    });

    it("draws a cleanly stopped response", async () => {
        const session = await run(recapResponse("Fixing the bridge integration. Next: rerun the suite."));
        expect(session.widgets).toEqual([["✦ recap", "Fixing the bridge integration. Next: rerun the suite."]]);
        expect(session.notices).toEqual([]);
    });
});

it("skips a custom API that only Pi can route, without reporting an error", async () => {
    const consoleError = vi.spyOn(console, "error");
    const session = loadRecap({ model: testModel("claude-bridge", "bridge", "bridge-model"), branch: exchange });
    await session.recap();

    expect(consoleError).not.toHaveBeenCalled();
    expect(session.notices).toEqual([]);
    expect(session.widgets).toEqual([]);
});
