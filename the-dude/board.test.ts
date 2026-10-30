import { type ChildProcess, spawn } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Board } from "./board.js";
import { readLayout } from "./ghostty.js";
import { type LiveSession, writeLive } from "./live.js";

initTheme(undefined, false);

vi.mock("./ghostty.js", () => ({ readLayout: vi.fn(async () => undefined), focusTerminal: vi.fn(async () => {}) }));

const theme = {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
};
const tui = { requestRender: () => {} } as unknown as TUI;
const UP = "\x1b[A";
const ESCAPE = "\x1b";

function transcript(text: string): string {
    const at = "2026-10-28T10:00:00.000Z";
    return `${[
        { type: "session", version: 3, id: "s", timestamp: at, cwd: "/" },
        {
            type: "message",
            id: "u1",
            parentId: null,
            timestamp: at,
            message: { role: "user", content: text, timestamp: 0 },
        },
    ]
        .map((entry) => JSON.stringify(entry))
        .join("\n")}\n`;
}

function live(pid: number, project: string, sessionFile: string): LiveSession {
    const now = new Date().toISOString();
    return {
        v: 1,
        pid,
        sessionId: `session-${pid}`,
        sessionFile,
        cwd: `/repo/${project}`,
        project: { key: project, name: project },
        label: `${project} session`,
        status: "idle",
        statusSince: now,
        startedAt: now,
        updatedAt: now,
    };
}

/** Let pending file reads finish: setImmediate is not faked. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe("Board peek", () => {
    let dir: string;
    let other: ChildProcess;
    let otherFile: string;
    let board: Board;

    beforeEach(async () => {
        vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
        dir = mkdtempSync(join(tmpdir(), "dude-board-"));
        otherFile = join(dir, "other.jsonl");
        const hereFile = join(dir, "here.jsonl");
        writeFileSync(otherFile, transcript("the other session's prompt"));
        writeFileSync(hereFile, transcript("this session's prompt"));
        other = spawn("sleep", ["60"]);
        // Projects sort by name, so "a" (the other session) sits above "b" (this one, selected first).
        writeLive(dir, live(other.pid!, "a", otherFile));
        writeLive(dir, live(process.pid, "b", hereFile));
        board = new Board(tui, theme as unknown as Theme, dir, () => {});
        await settle();
        board.handleInput(UP);
        board.handleInput(" ");
        await settle();
        expect(board.render(120).join("\n")).toContain("the other session's prompt");
    });

    afterEach(() => {
        board.dispose();
        other.kill();
        vi.useRealTimers();
        rmSync(dir, { recursive: true, force: true });
    });

    it("stays on a session that exits and says so, instead of switching to another one", async () => {
        other.kill();
        await new Promise((resolve) => other.once("exit", resolve));
        vi.advanceTimersByTime(1000);
        await settle();
        const screen = board.render(120).join("\n");
        expect(screen).toContain("This session ended.");
        expect(screen).not.toContain("this session's prompt");
    });

    it("stays closed when you close it while a read is in flight", async () => {
        appendFileSync(otherFile, "\n");
        utimesSync(otherFile, new Date(), new Date(Date.now() + 60_000));
        vi.advanceTimersByTime(1000);
        board.handleInput(ESCAPE);
        await settle();
        expect(board.render(120).join("\n")).toContain("space peek");
    });

    it("shows why it can't read Ghostty's windows", async () => {
        vi.mocked(readLayout).mockRejectedValueOnce(new Error("osascript timed out"));
        vi.advanceTimersByTime(2000);
        await settle();
        expect(board.render(120).join("\n")).toContain("osascript timed out");
    });
});
