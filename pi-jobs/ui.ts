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
import type { InboxItem, JobDetail, JobsResponse, RunRecord, RunTranscript } from "./api.js";
import { ago, client, lastRunLabel } from "./client.js";
import { reflow } from "./markdown.js";
import { openInPi } from "./open-in-pi.js";
import { transcriptMarkdown } from "./transcript.js";

const REFRESH_MS = 3000;
/** Box border, title, and hint rows around the body. */
const CHROME_ROWS = 6;

type View = "list" | "job" | "run";

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

/**
 * `/jobs` screen: job list with the inbox, then a job's runs, then one run's full transcript. Any run can be opened
 * in a fresh Pi session in a new Ghostty window.
 */
export class JobsOverlay implements Component {
    private view: View = "list";
    private data: JobsResponse | undefined;
    private inbox: InboxItem[] = [];
    private detail: JobDetail | undefined;
    private transcript: RunTranscript | undefined;
    private selectedJob = 0;
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

    private async refresh(): Promise<void> {
        try {
            const [data, inbox] = await Promise.all([client.jobs(), client.inbox()]);
            this.data = data;
            this.inbox = inbox;
            this.selectedJob = Math.min(this.selectedJob, Math.max(0, data.jobs.length - 1));
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

    private openRun(run: RunRecord): Promise<void> {
        return this.act(async () => {
            this.transcript = await client.transcript(this.detail!.name, run.requestId);
            this.view = "run";
            this.scroll = 0;
            return "";
        });
    }

    private openInPi(run: RunRecord): Promise<void> {
        return this.act(async () => {
            const transcript =
                this.transcript?.run.requestId === run.requestId
                    ? this.transcript
                    : await client.transcript(this.detail!.name, run.requestId);
            await openInPi(transcript);
            return "opened in a new Pi session";
        });
    }

    handleInput(data: string): void {
        const back = matchesKey(data, "escape") || matchesKey(data, "backspace") || matchesKey(data, "left");
        const page = Math.max(1, (process.stdout.rows ?? 30) - CHROME_ROWS - 2);
        if (this.view === "run") {
            if (back) {
                this.view = "job";
                this.scroll = 0;
            } else if (matchesKey(data, "up")) this.scroll = Math.max(0, this.scroll - 1);
            else if (matchesKey(data, "down")) this.scroll++;
            else if (matchesKey(data, "pageUp")) this.scroll = Math.max(0, this.scroll - page);
            else if (matchesKey(data, "pageDown") || data === " ") this.scroll += page;
            else if (data === "o" && this.transcript) void this.openInPi(this.transcript.run);
        } else if (this.view === "job" && this.detail) {
            const runs = this.detail.runs;
            if (back) {
                this.view = "list";
                this.detail = undefined;
            } else if (matchesKey(data, "up")) this.selectedRun = Math.max(0, this.selectedRun - 1);
            else if (matchesKey(data, "down")) this.selectedRun = Math.min(runs.length - 1, this.selectedRun + 1);
            else if (matchesKey(data, "return") && runs[this.selectedRun]) void this.openRun(runs[this.selectedRun]);
            else if (data === "o" && runs[this.selectedRun]) void this.openInPi(runs[this.selectedRun]);
            else if (data === "r") void this.runNow(this.detail.name);
        } else {
            const jobs = this.data?.jobs ?? [];
            if (matchesKey(data, "escape") || data === "q") {
                this.done();
                return;
            }
            if (matchesKey(data, "up")) this.selectedJob = Math.max(0, this.selectedJob - 1);
            else if (matchesKey(data, "down")) this.selectedJob = Math.min(jobs.length - 1, this.selectedJob + 1);
            else if (matchesKey(data, "return") && jobs[this.selectedJob])
                void this.openJob(jobs[this.selectedJob].name);
            else if (data === "r" && jobs[this.selectedJob]) void this.runNow(jobs[this.selectedJob].name);
        }
        this.tui.requestRender();
    }

    private listBody(width: number): string[] {
        const th = this.theme;
        const lines: string[] = [];
        const unread = this.inbox.filter((item) => !item.read);
        if (unread.length > 0) {
            lines.push(th.fg("accent", `Inbox (${unread.length} new)`));
            for (const item of unread.slice(0, 5)) {
                lines.push(
                    ` ${th.fg("warning", "●")} ${th.bold(item.title)} ${th.fg("dim", `${item.job} · ${ago(item.at)}`)}`,
                );
                for (const line of wrapTextWithAnsi(item.message, width - 4)) lines.push(`   ${line}`);
                if (item.url) lines.push(`   ${th.fg("dim", item.url)}`);
            }
            lines.push("");
        }
        const jobs = this.data?.jobs ?? [];
        lines.push(th.fg("accent", `Jobs ${th.fg("dim", this.data?.jobsDir ?? "")}`));
        if (jobs.length === 0) lines.push(th.fg("dim", " No jobs yet. Add <name>.md files to the jobs dir."));
        jobs.forEach((job, index) => {
            const pointer = index === this.selectedJob ? th.fg("accent", "▶ ") : "  ";
            const name = job.enabled ? job.name : th.fg("dim", `${job.name} (disabled)`);
            const last = th.fg(job.running ? "warning" : statusColor(job.lastRun), lastRunLabel(job));
            const next = job.nextRun ? th.fg("dim", `next ${ago(job.nextRun)}`) : "";
            lines.push(`${pointer}${name}  ${th.fg("dim", job.schedule)}  ${last}  ${next}`);
        });
        for (const error of this.data?.errors ?? []) {
            lines.push(th.fg("error", ` ✗ ${error.file}: ${error.error}`));
        }
        return lines;
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
            const pointer = index === this.selectedRun ? th.fg("accent", "▶ ") : "  ";
            const summary = (run.error ?? run.answer ?? "").split("\n").find((line) => line.trim()) ?? "";
            if (index === this.selectedRun) selectedLine = lines.length;
            lines.push(
                `${pointer}${th.fg(statusColor(run), run.status.padEnd(7))} ${th.fg("dim", `${run.trigger.padEnd(8)} ${ago(when).padEnd(8)}`)} ${summary}`,
            );
        });
        return { lines, selectedLine };
    }

    private runBody(transcript: RunTranscript, width: number): string[] {
        return markdownLines(transcriptMarkdown(transcript), width);
    }

    render(width: number): string[] {
        const th = this.theme;
        const inner = Math.max(20, width - 4);
        const height = Math.max(5, (process.stdout.rows ?? 30) - CHROME_ROWS);
        let body: string[];
        let hint: string;
        if (this.error) {
            body = [th.fg("error", this.error)];
            hint = "esc close";
        } else if (this.view === "run" && this.transcript) {
            body = this.runBody(this.transcript, inner);
            hint = "↑↓ PgUp PgDn scroll · o open in Pi · esc back";
        } else if (this.view === "job" && this.detail) {
            const { lines, selectedLine } = this.jobBody(this.detail, inner);
            body = lines;
            if (selectedLine < this.scroll) this.scroll = selectedLine;
            if (selectedLine >= this.scroll + height) this.scroll = selectedLine - height + 1;
            hint = "↑↓ select run · enter transcript · o open in Pi · r run now · esc back";
        } else {
            body = this.listBody(inner);
            this.scroll = 0;
            hint = "↑↓ select · enter open · r run now · esc close";
        }
        this.scroll = Math.min(this.scroll, Math.max(0, body.length - height));
        const visible = body.slice(this.scroll, this.scroll + height);
        const row = (content: string) => {
            const clipped = truncateToWidth(content, inner);
            return `${th.fg("border", "│")} ${clipped}${" ".repeat(Math.max(0, inner - visibleWidth(clipped)))} ${th.fg("border", "│")}`;
        };
        const position =
            body.length > height
                ? th.fg("dim", ` ${this.scroll + 1}-${this.scroll + visible.length}/${body.length}`)
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
