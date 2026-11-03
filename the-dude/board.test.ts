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

/** A theme that draws every token as its own invisible color code, so a test can tell which token drew what. */
const TOKENS = [
    "accent",
    "border",
    "borderAccent",
    "borderMuted",
    "dim",
    "muted",
    "success",
    "warning",
    "error",
    "text",
];
const fgCode = (token: string) => `\x1b[38;5;${TOKENS.indexOf(token) + 1}m`;
const bgCode = (token: string) => `\x1b[48;5;${token.length}m`;
const taggingTheme = {
    fg: (token: string, text: string) => `${fgCode(token)}${text}\x1b[39m`,
    bg: (token: string, text: string) => `${bgCode(token)}${text}\x1b[49m`,
    bold: (text: string) => text,
};

describe("Board colors", () => {
    let dir: string;
    const others: ChildProcess[] = [];
    let board: Board;

    beforeEach(async () => {
        vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
        dir = mkdtempSync(join(tmpdir(), "dude-colors-"));
        const statuses = ["needs-you", "unseen", "working"] as const;
        for (const [index, status] of statuses.entries()) {
            const process = spawn("sleep", ["60"]);
            others.push(process);
            writeLive(dir, {
                ...live(process.pid!, "app", ""),
                status,
                startedAt: `2026-10-28T10:00:0${index + 1}.000Z`,
            });
        }
        writeLive(dir, {
            ...live(process.pid, "app", ""),
            label: "the label",
            recap: { text: "the recap", at: "2026-10-28T10:00:00.000Z" },
            startedAt: "2026-10-28T10:00:00.000Z",
        });
        board = new Board(tui, taggingTheme as unknown as Theme, dir, () => {});
        await settle();
    });

    afterEach(() => {
        board.dispose();
        for (const other of others.splice(0)) other.kill();
        vi.useRealTimers();
        rmSync(dir, { recursive: true, force: true });
    });

    it("marks only the selected card, with an accent border and a selected background", () => {
        const screen = board.render(160).join("\n");
        // A card's corner closes its color right away; the board's frame runs on into its top line.
        const corners = (token: string) => screen.split(`${fgCode(token)}╭\x1b[39m`).length - 1;
        expect(corners("borderAccent")).toBe(1);
        expect(corners("borderMuted")).toBe(3);
        expect(screen.split(bgCode("selectedBg")).length - 1).toBe(4);
    });

    it("gives each status its own color and dims what is neither status nor recap", () => {
        const screen = board.render(160).join("\n");
        expect(screen).toContain(`${fgCode("error")}! needs you`);
        expect(screen).toContain(`${fgCode("success")}● done`);
        expect(screen).toContain(`${fgCode("warning")}◐ working`);
        expect(screen).toContain(`${fgCode("muted")}○ idle`);
        expect(screen).toContain(`${fgCode("dim")}the label`);
        expect(screen).toContain(`${fgCode("dim")}app`);
        expect(screen).toContain("the recap");
        expect(screen).not.toContain(`${fgCode("dim")}the recap`);
        expect(screen).not.toContain(`${fgCode("muted")}the recap`);
    });
});
