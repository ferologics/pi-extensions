/** Wire types shared by the pi-jobs daemon and its clients (the Pi extension, later a web page). */

export const DEFAULT_PORT = 4747;

export type RunTrigger = "schedule" | "manual";
export type RunStatus = "running" | "done" | "failed";

/** What a run sent with the notify tool. */
export interface RunNotification {
    title: string;
    message: string;
    url?: string;
    at: string;
}

export interface RunRecord {
    requestId: string;
    submissionId: number;
    trigger: RunTrigger;
    /** Scheduled slot (ISO) for schedule runs. */
    slot?: string;
    startedAt: string;
    finishedAt?: string;
    status: RunStatus;
    /** The run's final answer, capped. */
    answer?: string;
    error?: string;
    /** Every notify call of the run, in order. */
    notifications?: RunNotification[];
    /** Set when the run notified or failed, until its transcript is opened. Quiet runs are never unread. */
    unread?: boolean;
}

/** One step of a run, flattened from its Pi Durable entries. Thinking is left out. */
export type TranscriptItem =
    | { type: "handoff" | "user" | "assistant"; text: string }
    | { type: "tool_call"; tool: string; text: string }
    | { type: "tool_result"; tool: string; text: string; isError: boolean };

export interface RunTranscript {
    job: string;
    run: RunRecord;
    /** Where the run lives in Pi Durable, for digging deeper than this transcript. */
    durable: { statePath: string; conversationId: number };
    items: TranscriptItem[];
    /** True when the run had more entries than the transcript holds. */
    truncated: boolean;
}

export interface JobSummary {
    name: string;
    schedule: string;
    model: string;
    enabled: boolean;
    file: string;
    /** Tools the job's runs may call. */
    tools: string[];
    /** Shell command the job_command tool runs. */
    command?: string;
    nextRun?: string;
    lastRun?: RunRecord;
    running: boolean;
    /** Runs that notified or failed and were not opened yet. */
    unread: number;
    /** When the latest run started or finished. */
    lastActivity?: string;
}

export interface JobError {
    file: string;
    error: string;
}

export interface UnreadRun {
    job: string;
    run: RunRecord;
}

export interface JobsResponse {
    jobsDir: string;
    /** Tools a job can list in `tools` (every installed tool except job_command, which comes from `command`). */
    tools: string[];
    /** Runs to check, newest first. */
    unread: UnreadRun[];
    /** Jobs with unread runs first, then by latest activity. */
    jobs: JobSummary[];
    errors: JobError[];
}

export interface JobDetail extends JobSummary {
    prompt: string;
    runs: RunRecord[];
}
