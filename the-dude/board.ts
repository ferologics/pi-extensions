import { stat } from "node:fs/promises";
import { getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import {
    type Component,
    Markdown,
    matchesKey,
    type TUI,
    truncateToWidth,
    visibleWidth,
    wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { focusTerminal, type GhosttyWindow, readLayout } from "./ghostty.js";
import { countStatuses, type Group, groupSessions } from "./groups.js";
import { type LiveSession, listLive, type Priority, socketPath } from "./live.js";
import { readTail } from "./peek.js";
import { request } from "./socket.js";
import type { Status } from "./status.js";

const REFRESH_MS = 1000;
const LAYOUT_MS = 2000;
/** Box border, title, blank line and hint rows around the body. */
const CHROME_ROWS = 5;
const CARD_MIN_WIDTH = 38;
const CARD_HEIGHT = 6;
const GAP = 1;

const STATUS_LOOK: Record<Status, { glyph: string; label: string; color: "error" | "success" | "warning" | "dim" }> = {
    "needs-you": { glyph: "!", label: "needs you", color: "error" },
    unseen: { glyph: "●", label: "done", color: "success" },
    working: { glyph: "◐", label: "working", color: "warning" },
    idle: { glyph: "○", label: "idle", color: "dim" },
};

export function ago(iso: string, now = Date.now()): string {
    const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
    return `${Math.floor(seconds / 86400)}d`;
}

interface Cell {
    pid: number;
    row: number;
    col: number;
}

interface Peek {
    pid: number;
    parts: string[];
    mtimeMs: number;
    scroll: number;
}

/**
 * `/dude` board: every live Pi session as a card, grouped by Ghostty window and sorted by priority. Space peeks a
 * session's transcript tail in place, Enter focuses its terminal, `p` then 0–3 sets its priority.
 */
export class Board implements Component {
    private sessions: LiveSession[] = [];
    private layout: GhosttyWindow[] | undefined;
    private groups: Group[] = [];
    private selectedPid: number | undefined;
    private peek: Peek | undefined;
    private peekLoading = false;
    private choosingPriority = false;
    private scroll = 0;
    private flash = "";
    /** Why the last read of Ghostty's windows failed; groups fall back to projects meanwhile. */
    private layoutError = "";
    /** Inner width of the last render, so arrow keys move through the same columns you see. */
    private lastWidth = 80;
    private readonly timers: ReturnType<typeof setInterval>[];

    constructor(
        private readonly tui: TUI,
        private readonly theme: Theme,
        private readonly dir: string,
        private readonly done: () => void,
    ) {
        this.refresh();
        void this.refreshLayout();
        this.timers = [
            setInterval(() => this.refresh(), REFRESH_MS),
            setInterval(() => void this.refreshLayout(), LAYOUT_MS),
        ];
    }

    private refresh(): void {
        this.sessions = listLive(this.dir);
        this.groups = groupSessions(this.sessions, this.layout);
        const order = this.groups.flatMap((group) => group.sessions);
        // While a peek is open the selection stays on its session, so a session that exits shows as ended.
        if (!this.peek && !order.some((session) => session.pid === this.selectedPid)) {
            this.selectedPid = (order.find((session) => session.pid === process.pid) ?? order[0])?.pid;
        }
        if (this.peek) void this.loadPeek();
        this.tui.requestRender();
    }

    private async refreshLayout(): Promise<void> {
        try {
            this.layout = await readLayout();
            this.layoutError = "";
        } catch (error) {
            this.layoutError = `can't read Ghostty's windows: ${errorText(error)}`;
        }
        this.groups = groupSessions(this.sessions, this.layout);
        this.tui.requestRender();
    }

    private selected(): LiveSession | undefined {
        return this.sessions.find((session) => session.pid === this.selectedPid);
    }

    private openPeek(session: LiveSession): void {
        this.peek = { pid: session.pid, parts: ["*(loading…)*"], mtimeMs: -1, scroll: Number.MAX_SAFE_INTEGER };
        void this.loadPeek();
    }

    /** Re-read the peeked session's transcript when its file changed. One read at a time; a peek closed meanwhile stays closed. */
    private async loadPeek(): Promise<void> {
        const peek = this.peek;
        const session = this.sessions.find((candidate) => candidate.pid === peek?.pid);
        if (!peek || !session || this.peekLoading) return;
        if (!session.sessionFile) {
            this.peek = { ...peek, parts: ["*(no session file yet)*"] };
            return;
        }
        this.peekLoading = true;
        try {
            const { mtimeMs } = await stat(session.sessionFile);
            if (mtimeMs === peek.mtimeMs) return;
            const parts = await readTail(session.sessionFile);
            if (this.peek?.pid === peek.pid) this.peek = { ...this.peek, parts, mtimeMs };
        } catch (error) {
            if (this.peek?.pid === peek.pid) {
                this.peek = { ...this.peek, parts: [`*(can't read the session: ${errorText(error)})*`] };
            }
        } finally {
            this.peekLoading = false;
        }
        this.tui.requestRender();
    }

    private async act(action: () => Promise<string>): Promise<void> {
        try {
            this.flash = await action();
        } catch (error) {
            this.flash = errorText(error);
        }
        this.tui.requestRender();
    }

    private focus(session: LiveSession): void {
        if (session.pid === process.pid) {
            this.done();
            return;
        }
        const terminalId = session.terminalId;
        if (!terminalId) {
            this.flash = "not in a Ghostty window";
            return;
        }
        void this.act(async () => {
            await focusTerminal(terminalId);
            this.done();
            return "";
        });
    }

    private setPriority(session: LiveSession, priority: Priority | null): void {
        void this.act(async () => {
            const response = await request(socketPath(this.dir, session.pid), { type: "priority", priority });
            if (!response.ok) throw new Error(response.error);
            this.refresh();
            return priority === null ? "priority cleared" : `p${priority}`;
        });
    }

    /** Cards in display order with their grid row (across all groups) and column. */
    private cells(columns: number): Cell[] {
        const cells: Cell[] = [];
        let row = 0;
        for (const group of this.groups) {
            group.sessions.forEach((session, index) => {
                cells.push({ pid: session.pid, row: row + Math.floor(index / columns), col: index % columns });
            });
            row += Math.ceil(group.sessions.length / columns);
        }
        return cells;
    }

    private move(direction: "left" | "right" | "up" | "down"): void {
        const cells = this.cells(this.columns(this.lastWidth));
        const index = cells.findIndex((cell) => cell.pid === this.selectedPid);
        const current = cells[index];
        if (!current) return;
        let next: Cell | undefined;
        if (direction === "left") next = cells[index - 1];
        else if (direction === "right") next = cells[index + 1];
        else {
            const row = current.row + (direction === "up" ? -1 : 1);
            const candidates = cells.filter((cell) => cell.row === row);
            next = candidates.reduce<Cell | undefined>(
                (best, cell) =>
                    !best || Math.abs(cell.col - current.col) < Math.abs(best.col - current.col) ? cell : best,
                undefined,
            );
        }
        if (next) this.selectedPid = next.pid;
    }

    handleInput(data: string): void {
        const session = this.selected();
        this.flash = "";
        if (this.choosingPriority) {
            this.choosingPriority = false;
            if (session && /^[0-3]$/.test(data)) this.setPriority(session, Number(data) as Priority);
            else if (session && data === "-") this.setPriority(session, null);
        } else if (this.peek) {
            const page = Math.max(1, this.bodyHeight() - 2);
            if (matchesKey(data, "escape") || data === " " || data === "q") this.peek = undefined;
            else if (matchesKey(data, "up") || data === "k") this.peek.scroll = Math.max(0, this.peek.scroll - 1);
            else if (matchesKey(data, "down") || data === "j") this.peek.scroll++;
            else if (matchesKey(data, "pageUp")) this.peek.scroll = Math.max(0, this.peek.scroll - page);
            else if (matchesKey(data, "pageDown")) this.peek.scroll += page;
            else if (matchesKey(data, "return") && session) this.focus(session);
            else if (data === "p") this.choosingPriority = true;
        } else if (matchesKey(data, "escape") || data === "q") {
            this.done();
            return;
        } else if (matchesKey(data, "left") || data === "h") this.move("left");
        else if (matchesKey(data, "right") || data === "l") this.move("right");
        else if (matchesKey(data, "up") || data === "k") this.move("up");
        else if (matchesKey(data, "down") || data === "j") this.move("down");
        else if (data === " " && session) this.openPeek(session);
        else if (matchesKey(data, "return") && session) this.focus(session);
        else if (data === "p" && session) this.choosingPriority = true;
        this.tui.requestRender();
    }

    private columns(inner: number): number {
        return Math.max(1, Math.floor((inner + GAP) / (CARD_MIN_WIDTH + GAP)));
    }

    private bodyHeight(): number {
        return Math.max(5, (process.stdout.rows ?? 30) - CHROME_ROWS);
    }

    private card(session: LiveSession, width: number, selected: boolean): string[] {
        const th = this.theme;
        const look = STATUS_LOOK[session.status];
        const edge = (text: string) => (selected ? th.fg("accent", text) : th.fg("border", text));
        const inner = width - 4;
        const header = ` ${th.fg(look.color, `${look.glyph} ${look.label}`)} ${th.fg("dim", ago(session.statusSince))} `;
        const priority = session.priority === undefined ? "" : ` ${th.fg("accent", `p${session.priority}`)} `;
        const fill = Math.max(0, width - 2 - visibleWidth(header) - visibleWidth(priority));
        const top = edge("╭") + header + edge("─".repeat(fill)) + priority + edge("╮");
        const row = (text: string) => {
            const clipped = truncateToWidth(text, inner);
            return `${edge("│")} ${clipped}${" ".repeat(Math.max(0, inner - visibleWidth(clipped)))} ${edge("│")}`;
        };
        const here = session.pid === process.pid ? th.fg("accent", " · here") : "";
        const body: string[] = [
            th.fg("muted", session.project.name) + here,
            th.bold(session.label || th.fg("dim", "(new session)")),
        ];
        if (session.statusDetail) body.push(th.fg(look.color, session.statusDetail));
        if (session.recap) body.push(...wrapTextWithAnsi(th.fg("dim", session.recap.text), inner));
        const lines = body.slice(0, CARD_HEIGHT - 2);
        while (lines.length < CARD_HEIGHT - 2) lines.push("");
        return [top, ...lines.map(row), edge(`╰${"─".repeat(width - 2)}╯`)];
    }

    /** Grid lines and the line range of the selected card, so scrolling can keep it in view. */
    private gridBody(inner: number): { lines: string[]; selectedTop: number } {
        const th = this.theme;
        const columns = this.columns(inner);
        const width = Math.floor((inner - GAP * (columns - 1)) / columns);
        const lines: string[] = [];
        let selectedTop = 0;
        if (this.groups.length === 0) {
            lines.push(th.fg("dim", "No live Pi sessions. Sessions show up here once they run with the-dude loaded."));
        }
        for (const group of this.groups) {
            const priority = group.priority === undefined ? "" : th.fg("accent", ` p${group.priority}`);
            lines.push(th.fg("accent", th.bold(group.title)) + priority + th.fg("dim", ` · ${group.sessions.length}`));
            for (let start = 0; start < group.sessions.length; start += columns) {
                const cards = group.sessions.slice(start, start + columns).map((session) => {
                    if (session.pid === this.selectedPid) selectedTop = lines.length;
                    return this.card(session, width, session.pid === this.selectedPid);
                });
                for (let line = 0; line < CARD_HEIGHT; line++) {
                    lines.push(cards.map((card) => card[line]).join(" ".repeat(GAP)));
                }
            }
            lines.push("");
        }
        return { lines, selectedTop };
    }

    private peekBody(peek: Peek, inner: number): string[] {
        const th = this.theme;
        const session = this.selected();
        if (!session) return [th.fg("dim", "This session ended.")];
        const look = STATUS_LOOK[session.status];
        const lines = [
            `${th.bold(session.label || "(new session)")} ${th.fg(look.color, `${look.glyph} ${look.label}`)} ${th.fg("dim", ago(session.statusSince))}`,
            th.fg("dim", [session.project.name, session.model, session.cwd].filter(Boolean).join(" · ")),
        ];
        if (session.statusDetail) lines.push(th.fg(look.color, session.statusDetail));
        if (session.recap) lines.push("", ...wrapTextWithAnsi(th.fg("muted", `✦ ${session.recap.text}`), inner));
        lines.push(th.fg("border", "─".repeat(inner)));
        for (const part of peek.parts) {
            lines.push("", ...new Markdown(part, 0, 0, getMarkdownTheme()).render(inner).map((line) => line.trimEnd()));
        }
        return lines;
    }

    render(width: number): string[] {
        const th = this.theme;
        const inner = Math.max(20, width - 4);
        this.lastWidth = inner;
        const height = this.bodyHeight();
        let lines: string[];
        let hint: string;
        if (this.peek) {
            lines = this.peekBody(this.peek, inner);
            this.peek.scroll = Math.min(this.peek.scroll, Math.max(0, lines.length - height));
            lines = lines.slice(this.peek.scroll, this.peek.scroll + height);
            hint = "↑↓ PgUp PgDn scroll · enter focus · p priority · space/esc back";
        } else {
            const grid = this.gridBody(inner);
            if (grid.selectedTop < this.scroll) this.scroll = Math.max(0, grid.selectedTop - 1);
            if (grid.selectedTop + CARD_HEIGHT > this.scroll + height)
                this.scroll = grid.selectedTop + CARD_HEIGHT - height;
            this.scroll = Math.min(this.scroll, Math.max(0, grid.lines.length - height));
            lines = grid.lines.slice(this.scroll, this.scroll + height);
            hint = "←↑↓→ select · space peek · enter focus · p priority · esc close";
        }
        if (this.choosingPriority) hint = "priority: 0 1 2 3, - to clear, any other key to cancel";

        const counts = countStatuses(this.sessions);
        const summary = (["needs-you", "unseen", "working", "idle"] as const)
            .filter((status) => counts[status] > 0)
            .map((status) => th.fg(STATUS_LOOK[status].color, `${counts[status]} ${STATUS_LOOK[status].label}`))
            .join(th.fg("dim", " · "));
        const layoutError = this.layoutError ? th.fg("error", `  · ${this.layoutError}`) : "";
        const title = ` ${th.fg("accent", th.bold("dude"))}  ${summary}${layoutError}${this.flash ? th.fg("dim", `  · ${this.flash}`) : ""}`;
        const row = (content: string) => {
            const clipped = truncateToWidth(content, inner);
            return `${th.fg("border", "│")} ${clipped}${" ".repeat(Math.max(0, inner - visibleWidth(clipped)))} ${th.fg("border", "│")}`;
        };
        return [
            th.fg("border", `╭${"─".repeat(inner + 2)}╮`),
            row(title),
            ...lines.map(row),
            ...Array.from({ length: Math.max(0, height - lines.length) }, () => row("")),
            row(th.fg("dim", hint)),
            th.fg("border", `╰${"─".repeat(inner + 2)}╯`),
        ];
    }

    invalidate(): void {}

    dispose(): void {
        for (const timer of this.timers) clearInterval(timer);
    }
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
