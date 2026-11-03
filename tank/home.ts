// Tank's home: the one directory whose Pi sessions are Tank. It holds his prompt (AGENTS.md), his notes and the
// marker `.pi/tank.json`. Every other session stays an ordinary session.

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export const CONFIG_FILE = join(".pi", "tank.json");
export const NOTES_FILE = "NOTES.md";
/** NOTES.md is in Tank's prompt on every turn, so it stays short; topics hold the rest. */
export const NOTES_LIMIT = 4000;

export interface TankConfig {
    /** NOTES.md in his prompt and the tank_notes tool. Off: Tank keeps no notes. */
    notes: boolean;
}

export function isTankHome(cwd: string): boolean {
    return existsSync(join(cwd, CONFIG_FILE));
}

/** Tank's config when `cwd` is his home, else undefined. A broken config throws. */
export function readTankConfig(cwd: string): TankConfig | undefined {
    let raw: string;
    try {
        raw = readFileSync(join(cwd, CONFIG_FILE), "utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
    }
    const parsed = JSON.parse(raw) as { notes?: unknown };
    if (parsed.notes !== undefined && typeof parsed.notes !== "boolean") {
        throw new Error(`${CONFIG_FILE}: "notes" must be true or false`);
    }
    return { notes: parsed.notes ?? true };
}

export function readNotes(home: string): string {
    try {
        return readFileSync(join(home, NOTES_FILE), "utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
        throw error;
    }
}

/** A unified diff from the old to the new text of a notes file. */
async function diff(file: string, before: string, after: string): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), "tank-notes-"));
    try {
        writeFileSync(join(dir, "before"), before);
        writeFileSync(join(dir, "after"), after);
        // diff exits 1 when the files differ, which execFile reports as an error carrying the output.
        const { stdout } = await run("diff", [
            "-u",
            "--label",
            `a/${file}`,
            "--label",
            `b/${file}`,
            join(dir, "before"),
            join(dir, "after"),
        ]).catch((error: { code?: number; stdout?: string }) => {
            if (error.code === 1 && error.stdout !== undefined) return { stdout: error.stdout };
            throw error;
        });
        return stdout;
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

export type NotesResult = { committed: string } | { declined: true } | { unchanged: true };

/**
 * The one way Tank's notes change: show the diff, and only when it is accepted write the file and commit it.
 * `accept` gets the diff and says yes or no; in Tank's session that is a dialog for the user.
 */
export async function editNotes(
    home: string,
    file: string,
    content: string,
    why: string,
    accept: (diff: string) => Promise<boolean>,
): Promise<NotesResult> {
    if (file !== NOTES_FILE && !/^topics\/[a-z0-9][a-z0-9-]*\.md$/.test(file)) {
        throw new Error(`notes live in ${NOTES_FILE} or topics/<name>.md (lowercase, digits, dashes), not ${file}`);
    }
    if (file === NOTES_FILE && content.length > NOTES_LIMIT) {
        throw new Error(
            `${NOTES_FILE} would be ${content.length} characters; keep it under ${NOTES_LIMIT} and move detail to topics/`,
        );
    }
    const path = join(home, file);
    const before = existsSync(path) ? readFileSync(path, "utf8") : "";
    if (before === content) return { unchanged: true };
    if (!(await accept(await diff(file, before, content)))) return { declined: true };
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    await run("git", ["-C", home, "add", "--", file]);
    await run("git", ["-C", home, "commit", "-m", `notes: ${why}`, "--", file]);
    const { stdout } = await run("git", ["-C", home, "rev-parse", "--short", "HEAD"]);
    return { committed: stdout.trim() };
}
