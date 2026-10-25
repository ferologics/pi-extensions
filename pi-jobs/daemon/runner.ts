import { randomUUID } from "node:crypto";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
    AssistantEntry,
    type Conversation,
    type ConversationId,
    defineDoc,
    type Harness,
    type JsonObject,
    ResetEntry,
    type SubmissionId,
    type ToolRegistration,
} from "@earendil-works/pi-durable";
import type { InboxItem, JobDetail, JobsResponse, JobSummary, RunRecord, RunTrigger } from "../api.js";
import { COMMAND_TOOL, type JobDefinition, latestSlot, loadJobs, nextSlot } from "./jobs.js";

const context = BACKGROUND_CONTEXT;
const MAX_RUNS = 30;
const MAX_INBOX = 200;
const MAX_ANSWER = 8000;

type JobState = {
    conversationId: number;
    /** Slots before this are never run, so a new job waits for its first slot instead of firing at once. */
    firstSeen: string;
    /** Agent config last applied to the conversation, to skip redundant configure() commits. */
    config: string;
    lastSlot?: string;
    runs: RunRecord[];
};

type DaemonState = {
    jobs: Record<string, JobState>;
    inbox: InboxItem[];
};

const State = defineDoc<JsonObject>({
    kind: "pi-jobs.state",
    version: 1,
    scope: "session",
    initial: () => ({ jobs: {}, inbox: [] }),
    checkpointWhen: () => true,
});

function instructions(job: JobDefinition): string {
    return [
        `You are "${job.name}", a scheduled job run by pi-jobs with no human watching.`,
        "Each user message starts one run. Every run after the first starts from a handoff note holding the previous run's summary; it is all you know about earlier runs, so compare against it to tell what is new.",
        "Call the notify tool only when the task below says the finding needs the user's attention. Never notify about nothing new.",
        "End every run with a plain-text summary the next run can compare against: what you checked, what you found, and the current state of everything you watch (for example the latest version seen, or the entries currently listed).",
        ...(job.command
            ? [
                  `Start every run by calling ${COMMAND_TOOL}; it runs \`${job.command}\` and its output is what the run is about.`,
              ]
            : []),
        "",
        "Task:",
        job.prompt,
    ].join("\n");
}

function handoffNote(previous: RunRecord): string {
    const when = previous.finishedAt ?? previous.startedAt;
    return [
        `Handoff from the previous run (${previous.trigger}, finished ${when}). Its summary:`,
        "",
        previous.answer ?? "",
    ].join("\n");
}

function answerText(message: AssistantMessage | undefined): string {
    if (!message) return "";
    const text = message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
    return text.length > MAX_ANSWER ? `${text.slice(0, MAX_ANSWER)}\n[truncated]` : text;
}

export interface RunnerOptions {
    jobsDir: string;
    /** Every tool the daemon registers; a job's agent enables the ones its definition lists. */
    tools: readonly ToolRegistration[];
    log(message: string): void;
    desktopNotify(title: string, message: string): Promise<void>;
}

/** A job already has a run in progress; a job never runs twice at once. */
export class JobBusyError extends Error {}

export class JobRunner {
    private readonly watching = new Set<string>();
    private readonly harness: Harness;
    private readonly options: RunnerOptions;

    constructor(harness: Harness, options: RunnerOptions) {
        this.harness = harness;
        this.options = options;
    }

    private async state(): Promise<DaemonState> {
        return ((await this.harness.snapshot(State, context)) ?? { jobs: {}, inbox: [] }) as unknown as DaemonState;
    }

    private update<T>(change: (state: DaemonState) => T): Promise<T> {
        return this.harness.commit(async (tx) => change((await tx.doc(State)) as unknown as DaemonState), context);
    }

    private async conversation(id: number): Promise<Conversation> {
        const conversation = await this.harness.conversation(id as ConversationId, context);
        if (!conversation) throw new Error(`conversation ${id} is missing`);
        return conversation;
    }

    private enabledTools(job: JobDefinition): ToolRegistration[] {
        return job.tools.map((name) => {
            const tool = this.options.tools.find((candidate) => candidate.name === name);
            if (!tool) throw new Error(`tool ${name} is not registered`);
            return tool;
        });
    }

    /** Create the job's conversation on first sight and keep its agent in line with the definition. */
    private async sync(job: JobDefinition): Promise<JobState> {
        // null clears a field back to the host default, so removing `thinking` from a definition takes effect.
        const settings = { model: job.model, thinkingLevel: job.thinking ?? null, instructions: instructions(job) };
        const agent = { ...settings, tools: this.enabledTools(job) };
        const config = JSON.stringify({ ...settings, tools: job.tools });
        const existing = (await this.state()).jobs[job.name];
        if (existing) {
            if (existing.config !== config) {
                await (await this.conversation(existing.conversationId)).configure(agent as never, context);
                await this.update((state) => {
                    state.jobs[job.name].config = config;
                });
                this.options.log(`${job.name}: definition changed, agent reconfigured`);
            }
            return { ...existing, config };
        }
        const conversation = await this.harness.createConversation(
            {
                ownership: { kind: "ownerless" },
                agent: agent as never,
            },
            context,
        );
        const created: JobState = {
            conversationId: conversation.id,
            firstSeen: new Date().toISOString(),
            config,
            runs: [],
        };
        await this.update((state) => {
            state.jobs[job.name] = created;
        });
        this.options.log(`${job.name}: new job, conversation ${conversation.id}`);
        return created;
    }

    /** One scheduler pass: submit every enabled job whose latest slot has not run yet. */
    async tick(now = new Date()): Promise<void> {
        const { jobs, errors } = loadJobs(this.options.jobsDir);
        for (const error of errors) this.options.log(`invalid job ${error.file}: ${error.error}`);
        for (const job of jobs) {
            try {
                const state = await this.sync(job);
                if (!job.enabled) continue;
                // A slot that comes due during a run waits for it to finish.
                if (state.runs.some((run) => run.status === "running")) continue;
                const slot = latestSlot(job.schedule, now);
                if (slot < new Date(state.firstSeen)) continue;
                const slotIso = slot.toISOString();
                if (state.lastSlot && state.lastSlot >= slotIso) continue;
                await this.submit(job.name, "schedule", slotIso);
            } catch (error) {
                this.options.log(`${job.name}: ${error instanceof Error ? (error.stack ?? error.message) : error}`);
            }
        }
    }

    /** Admit one run; the requestId makes a repeat after a crash return the same submission. */
    async submit(name: string, trigger: RunTrigger, slot?: string): Promise<RunRecord> {
        const job = loadJobs(this.options.jobsDir).jobs.find((candidate) => candidate.name === name);
        if (!job) throw new Error(`unknown job "${name}"`);
        const state = await this.sync(job);
        if (state.runs.some((run) => run.status === "running"))
            throw new JobBusyError(`job "${name}" is already running`);
        const requestId = trigger === "schedule" ? `${name}@${slot}` : `${name}@manual-${randomUUID()}`;
        const conversation = await this.conversation(state.conversationId);
        const previous = state.runs.findLast((run) => run.status === "done" && run.answer);
        if (previous) {
            // Each run starts a new context from the previous run's summary; durable keeps the older entries in
            // storage. The reset is a write keyed like the run, so retrying after a crash never resets again.
            await conversation.submit(
                {
                    type: "write",
                    requestId: `${requestId}#reset`,
                    entry: {
                        kind: ResetEntry.kind,
                        head: "self",
                        model: [{ role: "user", content: handoffNote(previous), timestamp: Date.now() }],
                    },
                },
                context,
            );
        }
        const label = trigger === "schedule" ? `Scheduled run for slot ${slot}` : "Manual run";
        const submission = await conversation.submit(
            { type: "input", content: `${label}. Current time: ${new Date().toISOString()}.`, requestId },
            context,
        );
        const run: RunRecord = {
            requestId,
            submissionId: submission.id,
            trigger,
            ...(slot ? { slot } : {}),
            startedAt: new Date().toISOString(),
            status: "running",
        };
        const recorded = await this.update((current) => {
            const jobState = current.jobs[name];
            if (slot && (!jobState.lastSlot || jobState.lastSlot < slot)) jobState.lastSlot = slot;
            const known = jobState.runs.find((candidate) => candidate.requestId === requestId);
            if (known) return known;
            jobState.runs.push(run);
            if (jobState.runs.length > MAX_RUNS) jobState.runs.splice(0, jobState.runs.length - MAX_RUNS);
            return run;
        });
        this.options.log(`${name}: ${trigger} run ${requestId} submitted`);
        this.watch(name, recorded);
        return recorded;
    }

    /** Pick up runs a previous process left running. */
    async recover(): Promise<void> {
        const state = await this.state();
        for (const [name, job] of Object.entries(state.jobs)) {
            for (const run of job.runs) if (run.status === "running") this.watch(name, run);
        }
    }

    private watch(name: string, run: RunRecord): void {
        if (this.watching.has(run.requestId)) return;
        this.watching.add(run.requestId);
        void this.settle(name, run)
            .catch((error) => this.options.log(`${name}: watching ${run.requestId} failed: ${error}`))
            .finally(() => this.watching.delete(run.requestId));
    }

    private async settle(name: string, run: RunRecord): Promise<void> {
        const submission = await this.harness.submission(run.submissionId as SubmissionId, context);
        if (!submission) throw new Error(`submission ${run.submissionId} is missing`);
        const settled = await submission.wait(context);
        let patch: Partial<RunRecord>;
        if (settled.status === "done" && settled.type === "input") {
            const state = await this.state();
            const conversation = await this.conversation(state.jobs[name].conversationId);
            const entry = await conversation.commit((tx) => tx.entry(AssistantEntry, settled.answer), context);
            patch = { status: "done", answer: answerText(entry?.model?.[0] as AssistantMessage | undefined) };
        } else {
            const reason = settled.status === "unanswered" ? settled.reason : settled.status;
            patch = { status: "failed", error: reason };
            await this.options.desktopNotify(`pi-jobs: ${name} failed`, reason);
        }
        await this.update((state) => {
            const record = state.jobs[name]?.runs.find((candidate) => candidate.requestId === run.requestId);
            if (record) Object.assign(record, patch, { finishedAt: new Date().toISOString() });
        });
        this.options.log(`${name}: run ${run.requestId} ${patch.status}`);
    }

    private async jobName(conversationId: number): Promise<string | undefined> {
        const state = await this.state();
        return Object.entries(state.jobs).find(([, job]) => job.conversationId === conversationId)?.[0];
    }

    async command(conversationId: number): Promise<string | undefined> {
        const name = await this.jobName(conversationId);
        return loadJobs(this.options.jobsDir).jobs.find((job) => job.name === name)?.command;
    }

    async notify(conversationId: number, item: { title: string; message: string; url?: string }): Promise<void> {
        const job = (await this.jobName(conversationId)) ?? "unknown";
        await this.update((current) => {
            current.inbox.push({
                id: randomUUID(),
                job,
                title: item.title,
                message: item.message,
                ...(item.url ? { url: item.url } : {}),
                at: new Date().toISOString(),
                read: false,
            });
            if (current.inbox.length > MAX_INBOX) current.inbox.splice(0, current.inbox.length - MAX_INBOX);
        });
        await this.options.desktopNotify(`${job}: ${item.title}`, item.message);
    }

    private summary(job: JobDefinition, state: JobState | undefined, now: Date): JobSummary {
        const lastRun = state?.runs.at(-1);
        return {
            name: job.name,
            schedule: job.schedule,
            model: `${job.model.provider}/${job.model.modelId}`,
            enabled: job.enabled,
            file: job.file,
            tools: job.tools,
            ...(job.command ? { command: job.command } : {}),
            ...(job.enabled ? { nextRun: nextSlot(job.schedule, now).toISOString() } : {}),
            ...(lastRun ? { lastRun } : {}),
            running: state?.runs.some((run) => run.status === "running") ?? false,
        };
    }

    async list(): Promise<JobsResponse> {
        const { jobs, errors } = loadJobs(this.options.jobsDir);
        const state = await this.state();
        const now = new Date();
        return {
            jobsDir: this.options.jobsDir,
            jobs: jobs.map((job) => this.summary(job, state.jobs[job.name], now)),
            errors,
        };
    }

    async detail(name: string): Promise<JobDetail | undefined> {
        const job = loadJobs(this.options.jobsDir).jobs.find((candidate) => candidate.name === name);
        if (!job) return undefined;
        const state = (await this.state()).jobs[name];
        return {
            ...this.summary(job, state, new Date()),
            prompt: job.prompt,
            runs: [...(state?.runs ?? [])].reverse(),
        };
    }

    async inbox(): Promise<InboxItem[]> {
        return [...(await this.state()).inbox].reverse();
    }

    async markInboxRead(): Promise<number> {
        return this.update((state) => {
            let count = 0;
            for (const item of state.inbox) {
                if (!item.read) {
                    item.read = true;
                    count++;
                }
            }
            return count;
        });
    }
}
