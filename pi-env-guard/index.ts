/**
 * pi-env-guard: keeps secrets out of the commands Pi's agent runs.
 *
 * Pi passes its whole environment to every bash command. This replaces the bash tool with one whose child
 * environment drops matching variables, while Pi and its extensions keep them in process.env. A Pi started from
 * that bash (subagents, `pi -p`) can refill the dropped keys from a command you configure.
 *
 * Config: ~/.pi/agent/env-guard.json (see README.md).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createBashToolDefinition, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Names containing these are dropped unless the config sets its own `hide`. */
export const DEFAULT_HIDE = ["*KEY*", "*SECRET*", "*TOKEN*", "*PASSWORD*"];

export interface EnvGuardConfig {
    /** Variable names or `*` globs dropped from agent bash. */
    hide: string[];
    /** Env files (`KEY=...` lines) whose keys are dropped too. */
    envFiles: string[];
    /** Names or globs that stay, even when `hide` or `envFiles` match. */
    allow: string[];
    /** Command printing a dropped key's value, `{name}` replaced; refills named keys a Pi started without. */
    refill?: string[];
}

const CONFIG_KEYS = new Set(["hide", "envFiles", "allow", "refill"]);

function expandHome(path: string): string {
    return path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path;
}

function stringList(value: unknown, field: string): string[] {
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
        throw new Error(`pi-env-guard: "${field}" must be an array of strings`);
    }
    return value;
}

export function parseConfig(raw: unknown): EnvGuardConfig {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new Error("pi-env-guard: config must be a JSON object");
    }
    const fields = raw as Record<string, unknown>;
    for (const key of Object.keys(fields)) {
        if (!CONFIG_KEYS.has(key)) throw new Error(`pi-env-guard: unknown config key "${key}"`);
    }
    const refill = fields.refill === undefined ? undefined : stringList(fields.refill, "refill");
    if (refill?.length === 0) throw new Error(`pi-env-guard: "refill" must name a command`);
    return {
        hide: fields.hide === undefined ? DEFAULT_HIDE : stringList(fields.hide, "hide"),
        envFiles: fields.envFiles === undefined ? [] : stringList(fields.envFiles, "envFiles").map(expandHome),
        allow: fields.allow === undefined ? [] : stringList(fields.allow, "allow"),
        ...(refill ? { refill } : {}),
    };
}

/** The config file, or the defaults when there is none. */
export function loadConfig(path = join(homedir(), ".pi", "agent", "env-guard.json")): EnvGuardConfig {
    let text: string;
    try {
        text = readFileSync(path, "utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return parseConfig({});
        throw error;
    }
    return parseConfig(JSON.parse(text));
}

/** Keys an env file declares. A missing file declares none, so one config works on machines without it. */
export function envFileKeys(path: string): string[] {
    let text: string;
    try {
        text = readFileSync(path, "utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
    }
    const keys = new Set<string>();
    for (const raw of text.split("\n")) {
        const line = raw.trim();
        if (!line || line.startsWith("#")) continue;
        const key = line.split("=", 1)[0].trim();
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) keys.add(key);
    }
    return [...keys];
}

function globRegex(pattern: string): RegExp {
    const escaped = pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"));
    return new RegExp(`^${escaped.join(".*")}$`);
}

export interface Guard {
    isHidden(name: string): boolean;
    /** Hidden keys known by name (env files, exact `hide` entries): the ones `refill` can fetch. */
    named: string[];
}

export function createGuard(config: EnvGuardConfig): Guard {
    const hide = config.hide.map(globRegex);
    const allow = config.allow.map(globRegex);
    const fileKeys = new Set(config.envFiles.flatMap(envFileKeys));
    const isHidden = (name: string) =>
        (fileKeys.has(name) || hide.some((pattern) => pattern.test(name))) &&
        !allow.some((pattern) => pattern.test(name));
    const named = new Set([...fileKeys, ...config.hide.filter((pattern) => !pattern.includes("*"))]);
    return { isHidden, named: [...named].filter(isHidden) };
}

export function stripEnv(guard: Guard, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    return Object.fromEntries(Object.entries(env).filter(([name]) => !guard.isHidden(name)));
}

/** Fill the named hidden keys `env` lacks. A command that fails or prints nothing leaves the key unset. */
export function refill(guard: Guard, command: string[], env: NodeJS.ProcessEnv = process.env): void {
    const [file, ...args] = command;
    for (const name of guard.named) {
        if (env[name]) continue;
        let value: string;
        try {
            value = execFileSync(
                file,
                args.map((arg) => arg.replaceAll("{name}", name)),
                {
                    encoding: "utf8",
                    stdio: ["ignore", "pipe", "ignore"],
                },
            ).trim();
        } catch {
            continue;
        }
        if (value) env[name] = value;
    }
}

export default function envGuard(pi: ExtensionAPI): void {
    const config = loadConfig();
    const guard = createGuard(config);
    if (config.refill) refill(guard, config.refill);

    pi.registerTool(
        createBashToolDefinition(process.cwd(), {
            spawnHook: (context) => ({ ...context, env: stripEnv(guard, context.env) }),
        }),
    );
}
