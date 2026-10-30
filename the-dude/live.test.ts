import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type LiveSession, listLive, removeLive, socketPath, writeLive } from "./live.js";
import { normalizeRemote } from "./project.js";
import { close, listen, request } from "./socket.js";

const dirs: string[] = [];
function tempDir(): string {
    // Unix socket paths are limited to about 104 bytes on macOS, so keep this short.
    const dir = mkdtempSync(join(tmpdir(), "dude-"));
    dirs.push(dir);
    return dir;
}
afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function session(pid: number): LiveSession {
    const now = new Date().toISOString();
    return {
        v: 1,
        pid,
        sessionId: `session-${pid}`,
        cwd: "/tmp",
        project: { key: "github.com/a/b", name: "b" },
        label: "fix the thing",
        status: "idle",
        statusSince: now,
        startedAt: now,
        updatedAt: now,
    };
}

describe("live files", () => {
    it("lists live sessions and deletes entries of dead processes", async () => {
        const dir = tempDir();
        writeLive(dir, session(process.pid));
        const child = spawn(process.execPath, ["-e", ""]);
        const deadPid = child.pid!;
        await new Promise((resolve) => child.on("exit", resolve));
        writeLive(dir, session(deadPid));
        writeFileSync(socketPath(dir, deadPid), "");

        expect(listLive(dir).map((entry) => entry.pid)).toEqual([process.pid]);
        expect(existsSync(join(dir, `${deadPid}.json`))).toBe(false);
        expect(existsSync(socketPath(dir, deadPid))).toBe(false);

        removeLive(dir, process.pid);
        expect(listLive(dir)).toEqual([]);
    });

    it("returns nothing when the directory does not exist", () => {
        expect(listLive(join(tmpdir(), "dude-missing-dir"))).toEqual([]);
    });
});

describe("socket", () => {
    it("answers requests and rejects unknown ones", async () => {
        const dir = tempDir();
        const path = socketPath(dir, process.pid);
        const seen: unknown[] = [];
        const server = await listen(path, (incoming) => {
            seen.push(incoming);
            return { ok: true, data: "delivered" };
        });
        try {
            await expect(request(path, { type: "send", message: "hi", mode: "follow_up" })).resolves.toEqual({
                ok: true,
                data: "delivered",
            });
            await expect(request(path, { type: "priority", priority: 0 })).resolves.toEqual({
                ok: true,
                data: "delivered",
            });
            const bad = await request(path, { type: "send", message: " " });
            expect(bad.ok).toBe(false);
            expect(seen).toEqual([
                { type: "send", message: "hi", mode: "follow_up" },
                { type: "priority", priority: 0 },
            ]);
        } finally {
            await close(server, path);
        }
        expect(existsSync(path)).toBe(false);
    });
});

describe("normalizeRemote", () => {
    it("gives clones of one repo the same key whatever the URL form", () => {
        const key = "github.com/ferologics/pi-shit";
        expect(normalizeRemote("git@github.com:ferologics/pi-shit.git")).toBe(key);
        expect(normalizeRemote("https://github.com/ferologics/pi-shit")).toBe(key);
        expect(normalizeRemote("https://user@github.com/Ferologics/pi-shit.git/")).toBe(key);
        expect(normalizeRemote("ssh://git@github.com:22/ferologics/pi-shit.git")).toBe(key);
        expect(normalizeRemote("")).toBeUndefined();
    });
});
