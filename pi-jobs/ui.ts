import { getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { type Component, Markdown, matchesKey, type TUI, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { JobDetail, JobSummary, JobsResponse, RunRecord, RunTranscript } from "./api.js";
import { ago, client, lastRunLabel } from "./client.js";
import { reflow } from "./markdown.js";
import { openInPi } from "./open-in-pi.js";
import { transcriptMarkdown } from "./transcript.js";

const REFRESH_MS = 3000;
/** Box border, title, and hint rows around the body. */
const CHROME_ROWS = 6;

type View = "list" | "job" | "run";
/** A selectable row of the list view: a run to check, or a job. */
type ListRow = { kind: "run"; job: string; run: RunRecord } | { kind: "job"; job: JobSummary };

/** Render Markdown with Pi's theme, rewrapping hard-wrapped source lines to `width`. */
function markdownLines(text: string, width: number, color?: (text: string) => string): string[] {
    if (!text.trim()) return [];
    const markdown = new Markdown(reflow(text), 0, 0, getMarkdownTheme(), color ? { color } : undefined);
    return markdown.render(width).map((line) => line.trimEnd());
}

function statusColor(run: RunRecord | undefined): "success" | "error" | "warning" | "dim" {
    switch (run?.status) {
        case "done":
            return "success";
        case "failed":
            return "error";
        case "running":
            return "warning";
        default:
            return "dim";
    }
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function firstLine(text: string | undefined): string {
    return (text ?? "").split("\n").find((line) => line.trim()) ?? "";
}

/** One line about a run: what it notified, else why it failed, else how its answer starts. */
function runSummary(run: RunRecord): string {
    const notifications = run.notifications ?? [];
    if (notifications.length > 0) {
        const more = notifications.length > 1 ? ` (+${notifications.length - 1})` : "";
        return `${notifications[0].title}${more}`;
    }
    if (run.status === "failed") return `failed: ${firstLine(run.error)}`;
    return firstLine(run.answer);
}

/**
 * `/jobs` screen. The list puts runs to check (they notified or failed and were not opened yet) above the jobs, which
 * come sorted like a chat list. Below it: a job's runs, then one run's full transcript. Opening a run marks it read, and
 * any run can be opened in a fresh Pi session in a new Ghostty window.
 */
export class JobsOverlay implements Component {
    private view: View = "list";
    private data: JobsResponse | undefined;
    private detail: JobDetail | undefined;
    private transcript: RunTranscript | undefined;
    private selected = 0;
    private selectedRun = 0;
    private scroll = 0;
    private flash = "";
    private error = "";
    private readonly timer: ReturnType<typeof setInterval>;
    private readonly tui: TUI;
    private readonly theme: Theme;
    private readonly done: () => void;

    constructor(tui: TUI, theme: Theme, done: () => void) {
        this.tui = tui;
        this.theme = theme;
        this.done = done;
        void this.refresh();
        this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
    }

    private rows(): ListRow[] {
        const unread: ListRow[] = (this.data?.unread ?? []).map(({ job, run }) => ({ kind: "run", job, run }));
        const jobs: ListRow[] = (this.data?.jobs ?? []).map((job) => ({ kind: "job", job }));
        return [...unread, ...jobs];
    }

    private async refresh(): Promise<void> {
        try {
            this.data = await client.jobs();
            this.selected = Math.min(this.selected, Math.max(0, this.rows().length - 1));
            if (this.detail && this.view !== "list") {
                this.detail = await client.job(this.detail.name);
                this.selectedRun = Math.min(this.selectedRun, Math.max(0, this.detail.runs.length - 1));
            }
            const shown = this.transcript;
            if (shown && this.view === "run" && shown.run.status === "running") {
                this.transcript = await client.transcript(shown.job, shown.run.requestId);
            }
            this.error = "";
        } catch (error) {
            this.error = errorText(error);
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

    private runNow(name: string): Promise<void> {
        return this.act(async () => {
            await client.run(name);
            void this.refresh();
            return `started ${name}`;
        });
    }

    private openJob(name: string): Promise<void> {
        return this.act(async () => {
            this.detail = await client.job(name);
            this.view = "job";
            this.selectedRun = 0;
            this.scroll = 0;
            return "";
        });
    }

    private async markRead(job: string, run: RunRecord): Promise<void> {
        if (!run.unread) return;
        await client.markRead(job, run.requestId);
        void this.refresh();
    }

    /** Show a run's transcript; esc then returns to its job. */
    private openRun(job: string, run: RunRecord): Promise<void> {
        return this.act(async () => {
            if (this.detail?.name !== job) this.detail = await client.job(job);
            this.selectedRun = Math.max(
                0,
                this.detail.runs.findIndex((candidate) => candidate.requestId === run.requestId),
            );
            this.transcript = await client.transcript(job, run.requestId);
            this.view = "run";
            this.scroll = 0;
            await this.markRead(job, run);
            return "";
        });
    }

    private openInPi(job: string, run: RunRecord): Promise<void> {
        return this.act(async () => {
            const transcript =
                this.transcript?.run.requestId === run.requestId
                    ? this.transcript
                    : await client.transcript(job, run.requestId);
            await openInPi(transcript);
            await this.markRead(job, run);
            return "opened in a new Pi session";
        });
    }

    handleInput(data: string): void {
        const back = matchesKey(data, "escape") || matchesKey(data, "backspace") || matchesKey(data, "left");
        const page = Math.max(1, (process.stdout.rows ?? 30) - CHROME_ROWS - 2);
        if (this.view === "run" && this.transcript) {
            if (back) {
                this.view = "job";
                this.scroll = 0;
            } else if (matchesKey(data, "up")) this.scroll = Math.max(0, this.scroll - 1);
            else if (matchesKey(data, "down")) this.scroll++;
            else if (matchesKey(data, "pageUp")) this.scroll = Math.max(0, this.scroll - page);
            else if (matchesKey(data, "pageDown") || data === " ") this.scroll += page;
            else if (data === "o") void this.openInPi(this.transcript.job, this.transcript.run);
        } else if (this.view === "job" && this.detail) {
            const { name, runs } = this.detail;
            const run = runs[this.selectedRun];
            if (back) {
                this.view = "list";
                this.detail = undefined;
            } else if (matchesKey(data, "up")) this.selectedRun = Math.max(0, this.selectedRun - 1);
            else if (matchesKey(data, "down")) this.selectedRun = Math.min(runs.length - 1, this.selectedRun + 1);
            else if (matchesKey(data, "return") && run) void this.openRun(name, run);
            else if (data === "o" && run) void this.openInPi(name, run);
            else if (data === "r") void this.runNow(name);
        } else {
            const rows = this.rows();
            const row = rows[this.selected];
            if (matchesKey(data, "escape") || data === "q") {
                this.done();
                return;
            }
            if (matchesKey(data, "up")) this.selected = Math.max(0, this.selected - 1);
            else if (matchesKey(data, "down")) this.selected = Math.min(rows.length - 1, this.selected + 1);
            else if (row?.kind === "run" && matchesKey(data, "return")) void this.openRun(row.job, row.run);
            else if (row?.kind === "run" && data === "o") void this.openInPi(row.job, row.run);
            else if (row?.kind === "job" && matchesKey(data, "return")) void this.openJob(row.job.name);
            else if (row?.kind === "job" && data === "r") void this.runNow(row.job.name);
        }
        this.tui.requestRender();
    }

    private pointer(selected: boolean): string {
        return selected ? this.theme.fg("accent", "▶ ") : "  ";
    }

    private unreadMark(unread: boolean | undefined): string {
        return unread ? this.theme.fg("warning", "●") : " ";
    }

    /** The list view's lines and the line index of the selected row, so scrolling can keep it in view. */
    private listBody(): { lines: string[]; selectedLine: number } {
        const th = this.theme;
        const lines: string[] = [];
        let selectedLine = 0;
        const unread = this.data?.unread ?? [];
        if (unread.length > 0) {
            lines.push(th.fg("accent", `To check (${unread.length})`));
            unread.forEach(({ job, run }, index) => {
                if (index === this.selected) selectedLine = lines.length;
                const when = ago(run.finishedAt ?? run.startedAt);
                lines.push(
                    `${this.pointer(index === this.selected)}${this.unreadMark(true)} ${th.bold(job)} ${th.fg("dim", "·")} ${runSummary(run)} ${th.fg("dim", `· ${when}`)}`,
                );
                const detail = run.notifications?.[0]?.message ?? (run.status === "done" ? "" : firstLine(run.error));
                if (detail) lines.push(`    ${th.fg("dim", detail)}`);
            });
            lines.push("");
        }
        const jobs = this.data?.jobs ?? [];
        lines.push(th.fg("accent", `Jobs ${th.fg("dim", this.data?.jobsDir ?? "")}`));
        if (jobs.length === 0) lines.push(th.fg("dim", " No jobs yet. Add <name>.md files to the jobs dir."));
        jobs.forEach((job, offset) => {
            const index = unread.length + offset;
            if (index === this.selected) selectedLine = lines.length;
            const name = job.enabled ? job.name : th.fg("dim", `${job.name} (disabled)`);
            const last = th.fg(job.running ? "warning" : statusColor(job.lastRun), lastRunLabel(job));
            const next = job.nextRun ? th.fg("dim", `next ${ago(job.nextRun)}`) : "";
            // Fixed-width column, so names line up whether or not a job has runs to check.
            const count = th.fg("warning", (job.unread > 0 ? `● ${job.unread}` : "").padEnd(5));
            lines.push(
                `${this.pointer(index === this.selected)}${count}${name}  ${th.fg("dim", job.schedule)}  ${last}  ${next}`,
            );
        });
        for (const error of this.data?.errors ?? []) {
            lines.push(th.fg("error", ` ✗ ${error.file}: ${error.error}`));
        }
        return { lines, selectedLine };
    }

    /** The job view's lines and the line index of the selected run, so scrolling can keep it in view. */
    private jobBody(detail: JobDetail, width: number): { lines: string[]; selectedLine: number } {
        const th = this.theme;
        const lines = [
            `${th.bold(detail.name)} ${th.fg("dim", `${detail.schedule} · ${detail.model}${detail.enabled ? "" : " · disabled"}`)}`,
            th.fg("dim", detail.file),
            th.fg("dim", `tools: ${detail.tools.join(", ")}`),
            ...(detail.command ? [th.fg("dim", `command: ${detail.command}`)] : []),
            "",
            ...markdownLines(detail.prompt, width, (text) => th.fg("muted", text)),
            "",
            th.fg("accent", "Runs"),
        ];
        if (detail.runs.length === 0) lines.push(th.fg("dim", " No runs yet."));
        let selectedLine = lines.length;
        detail.runs.forEach((run, index) => {
            const when = run.finishedAt ?? run.startedAt;
            if (index === this.selectedRun) selectedLine = lines.length;
            lines.push(
                `${this.pointer(index === this.selectedRun)}${this.unreadMark(run.unread)} ${th.fg(statusColor(run), run.status.padEnd(7))} ${th.fg("dim", `${run.trigger.padEnd(8)} ${ago(when).padEnd(8)}`)} ${runSummary(run)}`,
            );
        });
        return { lines, selectedLine };
    }

    /** Body lines, the hint, and the line to keep in view for the current view. */
    private body(width: number): { lines: string[]; hint: string; selectedLine?: number } {
        if (this.error) return { lines: [this.theme.fg("error", this.error)], hint: "esc close" };
        if (this.view === "run" && this.transcript) {
            return {
                lines: markdownLines(transcriptMarkdown(this.transcript), width),
                hint: "↑↓ PgUp PgDn scroll · o open in Pi · esc back",
            };
        }
        if (this.view === "job" && this.detail) {
            return {
                ...this.jobBody(this.detail, width),
                hint: "↑↓ select run · enter transcript · o open in Pi · r run now · esc back",
            };
        }
        const row = this.rows()[this.selected];
        const hint =
            row?.kind === "run"
                ? "↑↓ select · enter transcript · o open in Pi · esc close"
                : "↑↓ select · enter open job · r run now · esc close";
        return { ...this.listBody(), hint };
    }

    render(width: number): string[] {
        const th = this.theme;
        const inner = Math.max(20, width - 4);
        const height = Math.max(5, (process.stdout.rows ?? 30) - CHROME_ROWS);
        const { lines, hint, selectedLine } = this.body(inner);
        if (selectedLine !== undefined) {
            if (selectedLine < this.scroll) this.scroll = selectedLine;
            if (selectedLine >= this.scroll + height) this.scroll = selectedLine - height + 1;
        }
        this.scroll = Math.min(this.scroll, Math.max(0, lines.length - height));
        const visible = lines.slice(this.scroll, this.scroll + height);
        const row = (content: string) => {
            const clipped = truncateToWidth(content, inner);
            return `${th.fg("border", "│")} ${clipped}${" ".repeat(Math.max(0, inner - visibleWidth(clipped)))} ${th.fg("border", "│")}`;
        };
        const position =
            lines.length > height
                ? th.fg("dim", ` ${this.scroll + 1}-${this.scroll + visible.length}/${lines.length}`)
                : "";
        const title = ` pi-jobs${position} ${this.flash ? th.fg("dim", `· ${this.flash}`) : ""}`;
        return [
            th.fg("border", `╭${"─".repeat(inner + 2)}╮`),
            row(th.fg("accent", title)),
            row(""),
            ...visible.map(row),
            ...Array.from({ length: Math.max(0, height - visible.length) }, () => row("")),
            row(th.fg("dim", hint)),
            th.fg("border", `╰${"─".repeat(inner + 2)}╯`),
        ];
    }

    invalidate(): void {}

    dispose(): void {
        clearInterval(this.timer);
    }
}
