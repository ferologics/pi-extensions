import { describe, expect, it } from "vitest";
import { findCurrentRecap } from "./index.js";
import { completeBranch, exchange, loadRecap, recapResponse, stubApi, testModel, userEntry } from "./test-harness.js";

const calls = stubApi("recap-saved-test", () => recapResponse("Fixing the bridge. Next: rerun the suite."));
const model = testModel("recap-saved-test");

const savedRecap = (text: string) => ({
    type: "custom",
    customType: "session-recap",
    data: { text, reason: "focus" },
});

// session_start shows a recap 300ms after the session opens.
const afterOpen = () => new Promise((resolve) => setTimeout(resolve, 400));

describe("findCurrentRecap", () => {
    it("returns the latest recap while only bookkeeping entries follow it", () => {
        const branch = completeBranch([
            ...exchange,
            savedRecap("Older recap."),
            savedRecap("Latest recap."),
            { type: "model_change", provider: "anthropic", modelId: "claude-opus-5-5" },
            { type: "label", targetId: "entry-0", label: "checkpoint" },
        ]);
        expect(findCurrentRecap(branch)?.text).toBe("Latest recap.");
    });

    it("drops the recap once the conversation moves on", () => {
        const branch = completeBranch([...exchange, savedRecap("Old recap."), userEntry("Next request.")]);
        expect(findCurrentRecap(branch)).toBeUndefined();
    });
});

it("saves each recap in the session", async () => {
    const session = loadRecap({ model, branch: exchange });
    await session.recap();

    expect(session.widgets).toEqual([["✦ recap", "Fixing the bridge. Next: rerun the suite."]]);
    expect(session.savedRecaps()).toEqual([{ text: "Fixing the bridge. Next: rerun the suite.", reason: "manual" }]);
});

describe("reopening a session from the CLI", () => {
    it("shows the saved recap without drafting a new one", async () => {
        const before = calls.length;
        const session = loadRecap({ model, branch: [...exchange, savedRecap("Saved recap.")] });
        session.startSession("startup");
        await afterOpen();

        expect(session.widgets).toEqual([["✦ recap", "Saved recap."]]);
        expect(calls.length).toBe(before);
        expect(session.savedRecaps()).toHaveLength(1);
    });

    it("drafts and saves a new recap when the conversation moved on", async () => {
        const before = calls.length;
        const session = loadRecap({
            model,
            branch: [...exchange, savedRecap("Old recap."), ...exchange],
        });
        session.startSession("startup");
        await afterOpen();

        expect(calls.length).toBe(before + 1);
        expect(session.widgets).toEqual([["✦ recap", "Fixing the bridge. Next: rerun the suite."]]);
        expect(session.savedRecaps().at(-1)).toEqual({
            text: "Fixing the bridge. Next: rerun the suite.",
            reason: "resume",
        });
    });

    it("stays quiet in a new session", async () => {
        const before = calls.length;
        const session = loadRecap({ model, branch: [] });
        session.startSession("startup");
        await afterOpen();

        expect(calls.length).toBe(before);
        expect(session.widgets).toEqual([]);
    });

    it("stays quiet when Pi is already working on a prompt", async () => {
        const before = calls.length;
        const session = loadRecap({ model, branch: exchange });
        session.setIdle(false);
        session.startSession("startup");
        await afterOpen();

        expect(calls.length).toBe(before);
        expect(session.widgets).toEqual([]);
    });
});
