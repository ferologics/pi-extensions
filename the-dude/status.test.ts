import { describe, expect, it } from "vitest";
import { FocusParser } from "./focus.js";
import { StatusTracker } from "./status.js";

describe("StatusTracker", () => {
    it("is working during a run and idle after it settles while you watch", () => {
        const tracker = new StatusTracker();
        expect(tracker.status).toBe("idle");
        tracker.runStarted();
        expect(tracker.status).toBe("working");
        tracker.runEnded(undefined);
        tracker.runSettled(false);
        expect(tracker.status).toBe("idle");
    });

    it("is unseen when the run finishes while the terminal is unfocused, until you focus it", () => {
        const tracker = new StatusTracker();
        tracker.runStarted();
        tracker.focusOut();
        tracker.runSettled(false);
        expect(tracker.status).toBe("unseen");
        tracker.focusIn();
        expect(tracker.status).toBe("idle");
    });

    it("clears unseen when you type", () => {
        const tracker = new StatusTracker();
        tracker.focusOut();
        tracker.runStarted();
        tracker.runSettled(false);
        tracker.input();
        expect(tracker.status).toBe("idle");
    });

    it("is idle after you abort, even while unfocused", () => {
        const tracker = new StatusTracker();
        tracker.runStarted();
        tracker.focusOut();
        tracker.runSettled(true);
        expect(tracker.status).toBe("idle");
    });

    it("needs you while a dialog opened during a run is open", () => {
        const tracker = new StatusTracker();
        tracker.runStarted();
        tracker.dialogOpened("Post to Slack?");
        expect(tracker.status).toBe("needs-you");
        expect(tracker.detail).toBe("Post to Slack?");
        tracker.dialogClosed();
        expect(tracker.status).toBe("working");
    });

    it("ignores dialogs you open while the session is idle", () => {
        const tracker = new StatusTracker();
        tracker.dialogOpened("custom");
        expect(tracker.status).toBe("idle");
    });

    it("needs you after a failed run until your next input, focused or not", () => {
        const tracker = new StatusTracker();
        tracker.runStarted();
        tracker.runEnded("overloaded");
        tracker.runSettled(false);
        expect(tracker.status).toBe("needs-you");
        expect(tracker.detail).toBe("failed: overloaded");
        tracker.focusIn();
        expect(tracker.status).toBe("needs-you");
        tracker.input();
        expect(tracker.status).toBe("idle");
    });

    it("uses the last low-level run's outcome, so a successful retry is not a failure", () => {
        const tracker = new StatusTracker();
        tracker.runStarted();
        tracker.runEnded("overloaded");
        tracker.runEnded(undefined);
        tracker.runSettled(false);
        expect(tracker.status).toBe("idle");
    });

    it("moves `since` only when the status changes", () => {
        const tracker = new StatusTracker();
        const start = tracker.since;
        tracker.focusIn();
        expect(tracker.since).toBe(start);
    });
});

describe("FocusParser", () => {
    it("finds focus reports, also across chunks", () => {
        const parser = new FocusParser();
        expect(parser.feed("ab\x1b[Icd\x1b[O")).toEqual(["in", "out"]);
        expect(parser.feed("\x1b")).toEqual([]);
        expect(parser.feed("[I")).toEqual(["in"]);
        expect(parser.feed("\x1b[A")).toEqual([]);
    });
});
