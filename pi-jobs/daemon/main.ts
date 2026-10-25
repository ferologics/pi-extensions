// pi-jobs daemon: runs scheduled Pi Durable jobs from markdown definitions and serves their state over HTTP.
import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { DEFAULT_PORT } from "../api.js";
import { JobRunner } from "./runner.js";
import { startServer } from "./server.js";
import { createJobTools } from "./tools.js";

const run = promisify(execFile);
const context = BACKGROUND_CONTEXT;
const TICK_MS = 30_000;

const home = homedir();
const jobsDir = process.env.PI_JOBS_DIR ?? join(home, ".config/pi-jobs/jobs");
const stateDir = process.env.PI_JOBS_STATE_DIR ?? join(home, ".local/state/pi-jobs");
const authPath = process.env.PI_JOBS_AUTH ?? join(home, ".pi/agent/auth.json");
const host = process.env.PI_JOBS_HOST ?? "127.0.0.1";
const port = Number(process.env.PI_JOBS_PORT ?? DEFAULT_PORT);

function log(message: string): void {
    console.log(`${new Date().toISOString()} ${message}`);
}

async function desktopNotify(title: string, message: string): Promise<void> {
    if (process.platform !== "darwin") return;
    const script = "on run argv\ndisplay notification (item 2 of argv) with title (item 1 of argv)\nend run";
    try {
        await run("/usr/bin/osascript", ["-e", script, title, message]);
    } catch (error) {
        log(`notification failed: ${error}`);
    }
}

log(`starting pid ${process.pid}`);
mkdirSync(stateDir, { recursive: true });
mkdirSync(jobsDir, { recursive: true });

const models = await ModelRuntime.create({ authPath });
let runner: JobRunner | undefined;
const tools = createJobTools({
    piCredential: async (provider) => (await models.getAuth(provider))?.auth.apiKey,
    notify: (conversationId, item) => runner!.notify(conversationId, item),
});
const registry = createRegistry();
registry.install(tools);

const harness = await Harness.open(
    await openNodeSqliteStorage(join(stateDir, "jobs.sqlite")),
    { models, registry, settings: { extensions: [tools] } },
    context,
);
runner = new JobRunner(harness, { jobsDir, log, desktopNotify });
harness.resume();
await runner.recover();

// Wall-clock ticks: each pass recomputes the latest slot from Date.now(), so time asleep cannot delay a run
// beyond one tick after wake. Missed slots collapse into the latest one.
let ticking = false;
async function tick(): Promise<void> {
    if (ticking) return;
    ticking = true;
    try {
        await runner!.tick();
    } catch (error) {
        log(`tick failed: ${error instanceof Error ? (error.stack ?? error.message) : error}`);
    } finally {
        ticking = false;
    }
}
await tick();
const timer = setInterval(tick, TICK_MS);
const server = startServer(runner, host, port, log);
log(`jobs dir ${jobsDir}, state ${stateDir}`);

async function shutdown(signal: string): Promise<void> {
    log(`${signal}: shutting down`);
    clearInterval(timer);
    server.close();
    await harness.close(context);
    process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
