import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RunRecord } from "./api.js";
import { ago, client, lastRunLabel } from "./client.js";
import { JobsOverlay } from "./ui.js";

const STATUS_KEY = "pi-jobs";

const GUIDELINES = [
    "pi-jobs runs scheduled jobs in a background daemon, independent of this session. Use jobs_list to see them, jobs_run to start one now, and jobs_results to read what runs found.",
    "To create or change a job, write ~/.config/pi-jobs/jobs/<name>.md (name: lowercase, digits, dashes). Frontmatter keys: schedule (required, 5-field cron in local time, quoted), model (provider/modelId, default anthropic/claude-sonnet-5-5), thinking (off|minimal|low|medium|high|xhigh), enabled (true|false), command (shell command, run through /bin/sh from the home directory), tools (comma-separated subset of web_search, web_fetch, notify; default all three). The markdown body is the job's standing task. The daemon picks up changes within 30 seconds; a new job first runs at its next slot (use jobs_run to run it now).",
    "Job runs have web_search, web_fetch, and notify, or the subset in `tools`. A job with a command also gets job_command, which runs it; give a job that reads untrusted output (logs, transcripts, scraped text) `tools: notify` so that output cannot drive web requests. Write the task so it says exactly when to call notify; each run sees the job's earlier runs, so 'only notify when something changed' works.",
];

function formatRun(run: RunRecord): string {
    const when = run.finishedAt ?? run.startedAt;
    const header = `${run.status} · ${run.trigger}${run.slot ? ` slot ${run.slot}` : ""} · ${when} (${ago(when)})`;
    const body = run.error ? `error: ${run.error}` : (run.answer ?? "");
    return body ? `${header}\n${body}` : header;
}

async function refreshStatus(ctx: ExtensionContext): Promise<void> {
    try {
        const unread = (await client.inbox()).filter((item) => !item.read).length;
        ctx.ui.setStatus(STATUS_KEY, unread > 0 ? `jobs: ${unread} new` : undefined);
    } catch {
        ctx.ui.setStatus(STATUS_KEY, undefined);
    }
}

export default function piJobs(pi: ExtensionAPI): void {
    pi.registerTool({
        name: "jobs_list",
        label: "Jobs",
        description: "List pi-jobs scheduled jobs with schedule, last run status, and next run.",
        promptSnippet: "List scheduled pi-jobs jobs",
        promptGuidelines: GUIDELINES,
        parameters: Type.Object({}),
        async execute() {
            const { jobsDir, jobs, errors } = await client.jobs();
            const lines = [`Jobs dir: ${jobsDir}`];
            for (const job of jobs) {
                lines.push(
                    `- ${job.name}${job.enabled ? "" : " (disabled)"}: "${job.schedule}", ${job.model}, last ${lastRunLabel(job)}` +
                        `${job.nextRun ? `, next ${job.nextRun} (${ago(job.nextRun)})` : ""}`,
                );
            }
            if (jobs.length === 0) lines.push("No jobs.");
            for (const error of errors) lines.push(`Invalid: ${error.file}: ${error.error}`);
            return { content: [{ type: "text", text: lines.join("\n") }], details: undefined };
        },
    });

    pi.registerTool({
        name: "jobs_run",
        label: "Run Job",
        description:
            "Start a pi-jobs job now, outside its schedule. Returns immediately; read the result with jobs_results.",
        promptSnippet: "Start a pi-jobs job now",
        parameters: Type.Object({ name: Type.String({ description: "Job name (its file name without .md)." }) }),
        async execute(_toolCallId, params) {
            const run = await client.run(params.name);
            return {
                content: [
                    {
                        type: "text",
                        text: `Started ${params.name} (${run.requestId}). Check jobs_results in a minute.`,
                    },
                ],
                details: undefined,
            };
        },
    });

    pi.registerTool({
        name: "jobs_results",
        label: "Job Results",
        description: "Show a pi-jobs job's prompt and its recent runs with their answers, newest first.",
        promptSnippet: "Read recent results of a pi-jobs job",
        parameters: Type.Object({
            name: Type.String({ description: "Job name." }),
            limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 30, description: "Runs to show (default 3)." })),
        }),
        async execute(_toolCallId, params) {
            const job = await client.job(params.name);
            const runs = job.runs.slice(0, params.limit ?? 3);
            const text = [
                `${job.name}: "${job.schedule}", ${job.model}${job.enabled ? "" : ", disabled"}`,
                `File: ${job.file}`,
                `Tools: ${job.tools.join(", ")}${job.command ? `\nCommand: ${job.command}` : ""}`,
                ...(runs.length > 0 ? runs.map(formatRun) : ["No runs yet."]),
            ].join("\n\n");
            return { content: [{ type: "text", text }], details: undefined };
        },
    });

    pi.registerCommand("jobs", {
        description: "Show pi-jobs jobs, their results, and the job inbox",
        handler: async (_args, ctx) => {
            if (ctx.mode !== "tui") {
                ctx.ui.notify("/jobs needs interactive mode; use the jobs_list tool instead", "error");
                return;
            }
            await ctx.ui.custom<void>((tui, theme, _keybindings, done) => new JobsOverlay(tui, theme, () => done()), {
                overlay: true,
                overlayOptions: { width: "80%", minWidth: 60, maxHeight: "85%" },
            });
            try {
                await client.markRead();
            } catch {
                // Daemon down: the overlay already showed why.
            }
            await refreshStatus(ctx);
        },
    });

    pi.on("session_start", async (_event, ctx) => {
        if (ctx.mode === "tui") await refreshStatus(ctx);
    });
}
