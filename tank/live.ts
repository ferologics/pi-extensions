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
    /** The Rex block ($REX_BLOCK) the session runs in, when it runs in Rex. Rex keeps it across server restarts. */
    terminalId?: string;
    status: Status;
    statusSince: string;
    /** Why the session needs you: a dialog's title or a run's error. */
    statusDetail?: string;
    priority?: Priority;
    recap?: { text: string; at: string };
    /** This session runs in Tank's home: it is Tank. */
    tank?: true;
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

function listLine(session: LiveSession): string {
    return `- ${session.sessionId} · ${session.project.name} · "${session.label}" · ${session.status}`;
}

/** A session by id, id prefix, exact label or unique label substring. */
export function resolveTarget(sessions: LiveSession[], target: string): LiveSession | string {
    const wanted = target.trim().toLowerCase();
    const byId = sessions.filter((session) => session.sessionId === wanted || session.sessionId.startsWith(wanted));
    if (byId.length === 1 && wanted.length >= 8) return byId[0]!;
    const exact = sessions.filter((session) => session.label.toLowerCase() === wanted);
    if (exact.length === 1) return exact[0]!;
    const partial = sessions.filter((session) => session.label.toLowerCase().includes(wanted));
    if (partial.length === 1 && exact.length === 0) return partial[0]!;
    const list = sessions.length > 0 ? sessions.map(listLine).join("\n") : "(none)";
    const problem =
        exact.length > 1 || partial.length > 1 ? "matches more than one session" : "matches no live session";
    return `"${target}" ${problem}. Live sessions:\n${list}`;
}
