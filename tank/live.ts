import { mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Status } from "./status.js";

export type Priority = 0 | 1 | 2 | 3;

/** What one running Pi process publishes about its session, in `<live dir>/<pid>.json`. */
export interface LiveSession {
    v: 1;
    pid: number;
    sessionId: string;
    sessionFile?: string;
    cwd: string;
    project: { key: string; name: string };
    /** The session's name, else the first line of its first prompt. */
    label: string;
    /** Ghostty's AppleScript terminal id (surface UUID), when the session runs in Ghostty. */
    terminalId?: string;
    status: Status;
    statusSince: string;
    /** Why the session needs you: a dialog's title or a run's error. */
    statusDetail?: string;
    priority?: Priority;
    recap?: { text: string; at: string };
    model?: string;
    startedAt: string;
    updatedAt: string;
}

export function liveDir(): string {
    const state = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
    return join(state, "pi", "live");
}

export function socketPath(dir: string, pid: number): string {
    return join(dir, `${pid}.sock`);
}

function entryPath(dir: string, pid: number): string {
    return join(dir, `${pid}.json`);
}

/** Write atomically, so readers never see half a file. */
export function writeLive(dir: string, session: LiveSession): void {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = entryPath(dir, session.pid);
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(session)}\n`, { mode: 0o600 });
    renameSync(temporary, file);
}

function unlinkQuietly(file: string): void {
    try {
        unlinkSync(file);
    } catch {}
}

export function removeLive(dir: string, pid: number): void {
    unlinkQuietly(entryPath(dir, pid));
    unlinkQuietly(socketPath(dir, pid));
}

export function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === "EPERM";
    }
}

/** Every live session. Entries left behind by processes that died (crash, kill -9) are deleted on the way. */
export function listLive(dir: string): LiveSession[] {
    let names: string[];
    try {
        names = readdirSync(dir);
    } catch {
        return [];
    }
    const sessions: LiveSession[] = [];
    for (const name of names) {
        const match = name.match(/^(\d+)\.json$/);
        if (!match) continue;
        const pid = Number(match[1]);
        if (!isAlive(pid)) {
            removeLive(dir, pid);
            continue;
        }
        try {
            const session = JSON.parse(readFileSync(join(dir, name), "utf8")) as LiveSession;
            if (session.v === 1 && session.pid === pid) sessions.push(session);
        } catch {}
    }
    return sessions;
}
