import { afterEach, describe, expect, it } from "vitest";
import { lookupTerminalId } from "./ghostty.js";

describe("lookupTerminalId", () => {
    const saved = { path: process.env.PATH, term: process.env.TERM_PROGRAM };
    afterEach(() => {
        process.env.PATH = saved.path;
        process.env.TERM_PROGRAM = saved.term;
    });

    it.runIf(process.platform === "darwin")(
        "reports a failed lookup instead of passing for 'not in Ghostty'",
        async () => {
            process.env.TERM_PROGRAM = "ghostty";
            process.env.PATH = "";
            await expect(lookupTerminalId()).rejects.toMatchObject({ code: "ENOENT" });
        },
    );

    it("is undefined outside Ghostty", async () => {
        process.env.TERM_PROGRAM = "tmux";
        await expect(lookupTerminalId()).resolves.toBeUndefined();
    });
});
