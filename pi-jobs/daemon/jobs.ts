import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { CronExpressionParser } from "cron-parser";
import type { JobError } from "../api.js";

export interface JobModel {
    provider: string;
    modelId: string;
}

export interface JobDefinition {
    name: string;
    file: string;
    schedule: string;
    model: JobModel;
    thinking?: string;
    enabled: boolean;
    prompt: string;
}

export const DEFAULT_MODEL = "anthropic/claude-sonnet-5-5";

const NAME = /^[a-z0-9][a-z0-9-]*$/;
const KEYS = new Set(["schedule", "model", "thinking", "enabled"]);
const THINKING = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);

/** Split `---` frontmatter of flat `key: value` lines from the markdown body. */
export function parseFrontmatter(text: string): { fields: Record<string, string>; body: string } {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
    if (!match) throw new Error("missing --- frontmatter");
    const fields: Record<string, string> = {};
    for (const raw of match[1].split(/\r?\n/)) {
        const line = raw.replace(/\s+#.*$/, "").trim();
        if (!line || line.startsWith("#")) continue;
        const colon = line.indexOf(":");
        if (colon < 1) throw new Error(`bad frontmatter line: ${raw}`);
        const key = line.slice(0, colon).trim();
        const value = line
            .slice(colon + 1)
            .trim()
            .replace(/^(["'])(.*)\1$/, "$2");
        fields[key] = value;
    }
    return { fields, body: match[2].trim() };
}

export function parseModel(value: string): JobModel {
    const slash = value.indexOf("/");
    if (slash < 1 || slash === value.length - 1) throw new Error(`model must be provider/modelId, got "${value}"`);
    return { provider: value.slice(0, slash), modelId: value.slice(slash + 1) };
}

export function parseJob(file: string, text: string): JobDefinition {
    const name = basename(file, ".md");
    if (!NAME.test(name)) throw new Error(`job file name must match ${NAME} (lowercase, digits, dashes)`);
    const { fields, body } = parseFrontmatter(text);
    for (const key of Object.keys(fields)) {
        if (!KEYS.has(key)) throw new Error(`unknown frontmatter key "${key}"`);
    }
    if (!fields.schedule) throw new Error("schedule is required (5-field cron, local time)");
    if (fields.schedule.trim().split(/\s+/).length !== 5) throw new Error("schedule must be a 5-field cron expression");
    CronExpressionParser.parse(fields.schedule);
    if (fields.thinking && !THINKING.has(fields.thinking))
        throw new Error(`unknown thinking level "${fields.thinking}"`);
    if (fields.enabled && fields.enabled !== "true" && fields.enabled !== "false") {
        throw new Error("enabled must be true or false");
    }
    if (!body) throw new Error("the prompt (markdown body) is empty");
    return {
        name,
        file,
        schedule: fields.schedule,
        model: parseModel(fields.model ?? DEFAULT_MODEL),
        thinking: fields.thinking,
        enabled: fields.enabled !== "false",
        prompt: body,
    };
}

export function loadJobs(dir: string): { jobs: JobDefinition[]; errors: JobError[] } {
    const jobs: JobDefinition[] = [];
    const errors: JobError[] = [];
    let files: string[];
    try {
        files = readdirSync(dir).filter((file) => file.endsWith(".md"));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return { jobs, errors };
        throw error;
    }
    for (const file of files.sort()) {
        const path = join(dir, file);
        try {
            jobs.push(parseJob(path, readFileSync(path, "utf8")));
        } catch (error) {
            errors.push({ file: path, error: error instanceof Error ? error.message : String(error) });
        }
    }
    return { jobs, errors };
}

/** The most recent slot at or before `now`. */
export function latestSlot(schedule: string, now: Date): Date {
    const probe = new Date(now.getTime() + 1000);
    return CronExpressionParser.parse(schedule, { currentDate: probe }).prev().toDate();
}

export function nextSlot(schedule: string, now: Date): Date {
    return CronExpressionParser.parse(schedule, { currentDate: now }).next().toDate();
}
