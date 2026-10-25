import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Type } from "@earendil-works/pi-ai";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead } from "@earendil-works/pi-coding-agent";
import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable";
import { COMMAND_TOOL } from "./jobs.js";

const run = promisify(execFile);
const COMMAND_TIMEOUT_MS = 10 * 60_000;
const COMMAND_MAX_BUFFER = 32 * 1024 * 1024;

export interface ToolHost {
    /** The `command` of the job that owns a conversation. */
    command(conversationId: number): Promise<string | undefined>;
    /** Attach a notification to the job's running run, mark it unread, and show a desktop notification. */
    notify(conversationId: number, item: { title: string; message: string; url?: string }): Promise<void>;
}

/**
 * Env first, then the launchctl cache that fish's Pi secrets bootstrap fills, so a daemon started at login
 * picks keys up once any shell warmed the cache.
 */
export async function secret(name: string): Promise<string | undefined> {
    const fromEnv = process.env[name]?.trim();
    if (fromEnv) return fromEnv;
    if (process.platform !== "darwin") return undefined;
    try {
        const { stdout } = await run("/bin/launchctl", ["getenv", name]);
        return stdout.trim() || undefined;
    } catch {
        return undefined;
    }
}

async function truncateForModel(text: string, label: string): Promise<string> {
    const truncation = truncateHead(text, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
    if (!truncation.truncated) return text;
    const path = join(await mkdtemp(join(tmpdir(), `pi-jobs-${label}-`)), "output.md");
    await writeFile(path, text, "utf8");
    return `${truncation.content}\n\n[Truncated to ${truncation.outputLines} of ${truncation.totalLines} lines. Full output: ${path}]`;
}

type CommandFailure = Error & {
    stdout?: string;
    stderr?: string;
    code?: number | string;
    killed?: boolean;
    signal?: string;
};

/** Run a job's command through /bin/sh from the home directory; a nonzero exit or timeout still returns its output. */
async function runCommand(command: string): Promise<{ text: string; failed: boolean }> {
    let stdout: string;
    let stderr: string;
    let status: string;
    let failed = false;
    try {
        ({ stdout, stderr } = await run("/bin/sh", ["-c", command], {
            cwd: homedir(),
            timeout: COMMAND_TIMEOUT_MS,
            maxBuffer: COMMAND_MAX_BUFFER,
        }));
        status = "exit code 0";
    } catch (error) {
        const failure = error as CommandFailure;
        if (failure.stdout === undefined) throw error;
        stdout = failure.stdout;
        stderr = failure.stderr ?? "";
        failed = true;
        status = failure.killed
            ? `killed by ${failure.signal ?? "a signal"} (timeout ${COMMAND_TIMEOUT_MS / 60_000} min)`
            : `exit code ${failure.code}`;
    }
    const parts = [`$ ${command}`, status, "", stdout.trimEnd()];
    if (stderr.trim()) parts.push("", "stderr:", stderr.trimEnd());
    return { text: parts.join("\n"), failed };
}

/** The only tools pi-jobs owns; everything else a job uses comes from other packages' durable extensions. */
export function createJobTools(host: ToolHost): Extension {
    // Not replay-safe: a command may have side effects, so a crash mid-call reports it as interrupted.
    const jobCommand = defineTool({
        name: COMMAND_TOOL,
        description: "Run this job's configured command on the user's Mac and return its exit status and output.",
        parameters: Type.Object({}),
        execute: async (_args, api) => {
            const command = await host.command(api.conversationId);
            if (!command) throw new Error("This job has no command.");
            api.output(`running ${command}\n`);
            const { text, failed } = await runCommand(command);
            return { output: [{ type: "text", text: await truncateForModel(text, "command") }], isError: failed };
        },
    });

    // Not replay-safe: a crash mid-call reports the call as interrupted instead of notifying twice.
    const notify = defineTool({
        name: "notify",
        description:
            "Notify the user: shows a desktop notification and marks this run as one to check in /jobs. " +
            "Call it only when the job's instructions say the finding needs the user's attention.",
        parameters: Type.Object({
            title: Type.String({ description: "Short headline." }),
            message: Type.String({ description: "One or two sentences: what changed and what to do." }),
            url: Type.Optional(Type.String({ description: "Link to the source, if any." })),
        }),
        execute: async (args, api) => {
            await host.notify(api.conversationId, args);
            return { output: [{ type: "text", text: "Notified." }] };
        },
    });

    return defineExtension({ name: "pi-jobs", tools: [jobCommand, notify] });
}
