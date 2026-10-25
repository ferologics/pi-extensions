/** Wire types shared by the pi-jobs daemon and its clients (the Pi extension, later a web page). */

export const DEFAULT_PORT = 4747;

export type RunTrigger = "schedule" | "manual";
export type RunStatus = "running" | "done" | "failed";

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
}

export interface JobError {
    file: string;
    error: string;
}

export interface JobsResponse {
    jobsDir: string;
    jobs: JobSummary[];
    errors: JobError[];
}

export interface JobDetail extends JobSummary {
    prompt: string;
    runs: RunRecord[];
}

export interface InboxItem {
    id: string;
    job: string;
    title: string;
    message: string;
    url?: string;
    at: string;
    read: boolean;
}
