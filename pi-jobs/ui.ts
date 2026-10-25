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
import type { InboxItem, JobDetail, JobsResponse, RunRecord } from "./api.js";
import { ago, client, lastRunLabel } from "./client.js";
import { reflow } from "./markdown.js";

const REFRESH_MS = 3000;

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

/** `/jobs` overlay: job list with inbox, and a scrollable detail view per job. */
export class JobsOverlay implements Component {
    private data: JobsResponse | undefined;
    private inbox: InboxItem[] = [];
    private detail: JobDetail | undefined;
    private selected = 0;
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
            if (this.detail) this.detail = await client.job(this.detail.name);
            this.selected = Math.min(this.selected, Math.max(0, data.jobs.length - 1));
            this.error = "";
        } catch (error) {
            this.error = error instanceof Error ? error.message : String(error);
        }
        this.tui.requestRender();
    }

    private async runSelected(name: string): Promise<void> {
        try {
            await client.run(name);
            this.flash = `started ${name}`;
        } catch (error) {
            this.flash = error instanceof Error ? error.message : String(error);
        }
        await this.refresh();
    }

    handleInput(data: string): void {
        const jobs = this.data?.jobs ?? [];
        if (this.detail) {
            if (matchesKey(data, "escape") || matchesKey(data, "backspace") || matchesKey(data, "left")) {
                this.detail = undefined;
                this.scroll = 0;
            } else if (matchesKey(data, "up")) this.scroll = Math.max(0, this.scroll - 1);
            else if (matchesKey(data, "down")) this.scroll++;
            else if (data === "r") void this.runSelected(this.detail.name);
            this.tui.requestRender();
            return;
        }
        if (matchesKey(data, "escape") || data === "q") {
            this.done();
            return;
        }
        if (matchesKey(data, "up")) this.selected = Math.max(0, this.selected - 1);
        else if (matchesKey(data, "down")) this.selected = Math.min(jobs.length - 1, this.selected + 1);
        else if (matchesKey(data, "return") && jobs[this.selected]) {
            const name = jobs[this.selected].name;
            void client.job(name).then(
                (detail) => {
                    this.detail = detail;
                    this.scroll = 0;
                    this.tui.requestRender();
                },
                (error) => {
                    this.flash = String(error);
                    this.tui.requestRender();
                },
            );
        } else if (data === "r" && jobs[this.selected]) void this.runSelected(jobs[this.selected].name);
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
            const pointer = index === this.selected ? th.fg("accent", "▶ ") : "  ";
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

    private detailBody(detail: JobDetail, width: number): string[] {
        const th = this.theme;
        const lines = [
            `${th.bold(detail.name)} ${th.fg("dim", `${detail.schedule} · ${detail.model}${detail.enabled ? "" : " · disabled"}`)}`,
            th.fg("dim", detail.file),
            th.fg("dim", `tools: ${detail.tools.join(", ")}`),
            ...(detail.command ? [th.fg("dim", `command: ${detail.command}`)] : []),
            "",
        ];
        lines.push(...markdownLines(detail.prompt, width, (text) => th.fg("muted", text)));
        lines.push("");
        if (detail.runs.length === 0) lines.push(th.fg("dim", "No runs yet."));
        detail.runs.forEach((run, index) => {
            const when = run.finishedAt ?? run.startedAt;
            lines.push(
                `${th.fg(statusColor(run), run.status)} ${th.fg("dim", `${run.trigger} · ${ago(when)} · ${new Date(when).toLocaleString()}`)}`,
            );
            const text = run.error ?? run.answer ?? "";
            // Full text for the latest run, first line for older ones.
            const shown = index === 0 ? text : text.split("\n")[0];
            const rendered = markdownLines(shown, width - 2);
            for (const line of index === 0 ? rendered : rendered.slice(0, 1)) lines.push(`  ${line}`);
            lines.push("");
        });
        return lines;
    }

    render(width: number): string[] {
        const th = this.theme;
        const inner = Math.max(20, width - 4);
        const height = Math.max(10, Math.floor((process.stdout.rows ?? 30) * 0.8) - 4);
        let body: string[];
        if (this.error) body = [th.fg("error", this.error)];
        else if (this.detail) body = this.detailBody(this.detail, inner);
        else body = this.listBody(inner);
        if (this.detail) this.scroll = Math.min(this.scroll, Math.max(0, body.length - height));
        const visible = this.detail ? body.slice(this.scroll, this.scroll + height) : body.slice(0, height);
        const hint = this.detail
            ? "↑↓ scroll · r run now · esc back"
            : "↑↓ select · enter open · r run now · esc close";
        const row = (content: string) => {
            const clipped = truncateToWidth(content, inner);
            return `${th.fg("border", "│")} ${clipped}${" ".repeat(Math.max(0, inner - visibleWidth(clipped)))} ${th.fg("border", "│")}`;
        };
        const title = ` pi-jobs ${this.flash ? th.fg("dim", `· ${this.flash}`) : ""}`;
        return [
            th.fg("border", `╭${"─".repeat(inner + 2)}╮`),
            row(th.fg("accent", title)),
            row(""),
            ...visible.map(row),
            row(""),
            row(th.fg("dim", hint)),
            th.fg("border", `╰${"─".repeat(inner + 2)}╯`),
        ];
    }

    invalidate(): void {}

    dispose(): void {
        clearInterval(this.timer);
    }
}
