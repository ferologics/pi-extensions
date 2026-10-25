import {
    DEFAULT_PORT,
    type InboxItem,
    type JobDetail,
    type JobSummary,
    type JobsResponse,
    type RunRecord,
} from "./api.js";

export const DAEMON_URL = (process.env.PI_JOBS_URL ?? `http://127.0.0.1:${DEFAULT_PORT}`).replace(/\/$/, "");

async function request<T>(method: "GET" | "POST", path: string): Promise<T> {
    let response: Response;
    try {
        response = await fetch(`${DAEMON_URL}${path}`, { method, signal: AbortSignal.timeout(5000) });
    } catch {
        throw new Error(`pi-jobs daemon is not reachable at ${DAEMON_URL}. Start it with \`just install\` in pi-jobs.`);
    }
    const body = (await response.json()) as T & { error?: string };
    if (!response.ok) throw new Error(body.error ?? `pi-jobs ${method} ${path} failed with HTTP ${response.status}`);
    return body;
}

export const client = {
    jobs: () => request<JobsResponse>("GET", "/api/jobs"),
    job: (name: string) => request<JobDetail>("GET", `/api/jobs/${encodeURIComponent(name)}`),
    run: (name: string) => request<RunRecord>("POST", `/api/jobs/${encodeURIComponent(name)}/run`),
    inbox: () => request<InboxItem[]>("GET", "/api/inbox"),
    markRead: () => request<{ marked: number }>("POST", "/api/inbox/read"),
};

export function ago(iso: string | undefined, now = Date.now()): string {
    if (!iso) return "never";
    const seconds = Math.round((now - Date.parse(iso)) / 1000);
    const abs = Math.abs(seconds);
    let text: string;
    if (abs < 60) text = `${abs}s`;
    else if (abs < 3600) text = `${Math.round(abs / 60)}m`;
    else if (abs < 86400) text = `${Math.round(abs / 3600)}h`;
    else text = `${Math.round(abs / 86400)}d`;
    return seconds < 0 ? `in ${text}` : `${text} ago`;
}

export function lastRunLabel(job: JobSummary): string {
    if (job.running) return "running";
    if (!job.lastRun) return "never ran";
    return `${job.lastRun.status} ${ago(job.lastRun.finishedAt ?? job.lastRun.startedAt)}`;
}
