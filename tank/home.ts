// Tank's home: the one directory whose Pi sessions are Tank. It holds his prompt (AGENTS.md), his notes and the
// marker `.pi/tank.json`. Every other session stays an ordinary session.

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

export type NotesResult = { committed: string } | { unchanged: true };

/** The one way Tank's notes change: write the file and commit it, so `git log` and `git revert` cover every edit. */
export async function editNotes(home: string, file: string, content: string, why: string): Promise<NotesResult> {
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
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    await run("git", ["-C", home, "add", "--", file]);
    await run("git", ["-C", home, "commit", "-m", `notes: ${why}`, "--", file]);
    const { stdout } = await run("git", ["-C", home, "rev-parse", "--short", "HEAD"]);
    return { committed: stdout.trim() };
}
