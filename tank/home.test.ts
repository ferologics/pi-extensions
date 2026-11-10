import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONFIG_FILE, editNotes, NOTES_LIMIT, readTankConfig } from "./home.js";

let home: string;
const git = (...args: string[]) => execFileSync("git", ["-C", home, ...args], { encoding: "utf8" }).trim();

beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "tank-home-"));
    git("init", "-q");
    git("config", "user.email", "tank@example.invalid");
    git("config", "user.name", "Tank test");
    writeFileSync(join(home, "NOTES.md"), "# Notes\n\n## Priorities\n");
    git("add", ".");
    git("commit", "-q", "-m", "start");
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("readTankConfig", () => {
    it("is undefined outside Tank's home and defaults notes to on inside it", () => {
        expect(readTankConfig(home)).toBeUndefined();
        mkdirSync(join(home, ".pi"));
        writeFileSync(join(home, CONFIG_FILE), "{}");
        expect(readTankConfig(home)).toEqual({ notes: true });
        writeFileSync(join(home, CONFIG_FILE), '{ "notes": false }');
        expect(readTankConfig(home)).toEqual({ notes: false });
    });

    it("throws on a config it can't use", () => {
        mkdirSync(join(home, ".pi"));
        writeFileSync(join(home, CONFIG_FILE), '{ "notes": "yes" }');
        expect(() => readTankConfig(home)).toThrow('"notes" must be true or false');
    });
});

describe("editNotes", () => {
    const next = "# Notes\n\n## Priorities\n\n- 2026-10-31 p0: the tank board\n";

    it("commits only the notes file", async () => {
        writeFileSync(join(home, "unrelated.md"), "not his to commit\n");
        const result = await editNotes(home, "NOTES.md", next, "p0 is the tank board");
        expect(result).toMatchObject({ committed: expect.any(String) });
        expect(readFileSync(join(home, "NOTES.md"), "utf8")).toBe(next);
        expect(git("log", "-1", "--format=%s")).toBe("notes: p0 is the tank board");
        expect(git("status", "--porcelain")).toBe("?? unrelated.md");
    });

    it("creates topic notes, and refuses other paths and an oversized NOTES.md", async () => {
        await editNotes(home, "topics/mobile-e2e.md", "# Mobile e2e\n", "new topic");
        expect(readFileSync(join(home, "topics/mobile-e2e.md"), "utf8")).toBe("# Mobile e2e\n");
        await expect(editNotes(home, "../escape.md", "x", "x")).rejects.toThrow("notes live in");
        await expect(editNotes(home, "NOTES.md", "x".repeat(NOTES_LIMIT + 1), "x")).rejects.toThrow("keep it under");
    });
});
