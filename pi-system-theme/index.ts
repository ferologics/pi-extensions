import { execFile } from "node:child_process";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";

const execFileAsync = promisify(execFile);

type Appearance = "dark" | "light" | "unknown";

type RawConfig = {
    darkTheme?: unknown;
    lightTheme?: unknown;
    pollMs?: unknown;
};

type Config = {
    darkTheme: string;
    lightTheme: string;
    pollMs: number;
};

const DEFAULT_CONFIG: Config = {
    darkTheme: "dark",
    lightTheme: "light",
    pollMs: 2000,
};

const GLOBAL_CONFIG_PATH = path.join(os.homedir(), ".pi", "agent", "system-theme.json");
const MIN_POLL_MS = 500;
const DETECTION_TIMEOUT_MS = 1200;

function toNonEmptyString(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

function toPositiveInteger(value: unknown): number | undefined {
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;

    const rounded = Math.round(value);
    return rounded > 0 ? rounded : undefined;
}

function mergeConfig(base: Config, rawConfig: RawConfig | undefined): Config {
    if (!rawConfig) return base;

    const darkTheme = toNonEmptyString(rawConfig.darkTheme) ?? base.darkTheme;
    const lightTheme = toNonEmptyString(rawConfig.lightTheme) ?? base.lightTheme;

    const pollMsValue = toPositiveInteger(rawConfig.pollMs);
    const pollMs = pollMsValue ? Math.max(pollMsValue, MIN_POLL_MS) : base.pollMs;

    return {
        darkTheme,
        lightTheme,
        pollMs,
    };
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readConfig(pathToConfig: string): Promise<RawConfig | undefined> {
    try {
        await access(pathToConfig);
    } catch {
        return undefined;
    }

    try {
        const rawContent = await readFile(pathToConfig, "utf8");
        const parsed = JSON.parse(rawContent) as unknown;

        if (!isObject(parsed)) {
            console.warn(`[pi-system-theme] Ignoring ${pathToConfig}: expected a JSON object.`);
            return undefined;
        }

        return parsed;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[pi-system-theme] Failed to load ${pathToConfig}: ${message}`);
        return undefined;
    }
}

async function loadConfig(): Promise<Config> {
    const globalConfig = await readConfig(GLOBAL_CONFIG_PATH);
    return mergeConfig(DEFAULT_CONFIG, globalConfig);
}

function getOverrides(config: Config): Record<string, string | number> {
    const overrides: Record<string, string | number> = {};

    if (config.darkTheme !== DEFAULT_CONFIG.darkTheme) {
        overrides.darkTheme = config.darkTheme;
    }

    if (config.lightTheme !== DEFAULT_CONFIG.lightTheme) {
        overrides.lightTheme = config.lightTheme;
    }

    if (config.pollMs !== DEFAULT_CONFIG.pollMs) {
        overrides.pollMs = config.pollMs;
    }

    return overrides;
}

async function writeGlobalOverrides(config: Config): Promise<{ wroteFile: boolean; overrideCount: number }> {
    const overrides = getOverrides(config);
    const overrideCount = Object.keys(overrides).length;

    if (overrideCount === 0) {
        await rm(GLOBAL_CONFIG_PATH, { force: true });
        return { wroteFile: false, overrideCount };
    }

    await mkdir(path.dirname(GLOBAL_CONFIG_PATH), { recursive: true });
    await writeFile(GLOBAL_CONFIG_PATH, `${JSON.stringify(overrides, null, 4)}\n`, "utf8");

    return { wroteFile: true, overrideCount };
}

function extractStderr(error: unknown): string {
    if (typeof error !== "object" || error === null) return "";

    const maybeStderr = (error as { stderr?: unknown }).stderr;
    return typeof maybeStderr === "string" ? maybeStderr : "";
}

async function detectAppearance(): Promise<Appearance> {
    try {
        const { stdout } = await execFileAsync("/usr/bin/defaults", ["read", "-g", "AppleInterfaceStyle"], {
            timeout: DETECTION_TIMEOUT_MS,
            windowsHide: true,
        });

        const normalized = stdout.trim().toLowerCase();
        if (normalized === "dark") return "dark";
        if (normalized === "light") return "light";

        return "unknown";
    } catch (error) {
        const stderr = extractStderr(error).toLowerCase();
        if (stderr.includes("does not exist")) {
            return "light";
        }

        return "unknown";
    }
}

function getRequestedTheme(config: Config, appearance: Exclude<Appearance, "unknown">): string {
    return appearance === "dark" ? config.darkTheme : config.lightTheme;
}

function getBuiltinFallbackTheme(appearance: Exclude<Appearance, "unknown">): string {
    return appearance === "dark" ? "dark" : "light";
}

function resolveThemeName(
    ctx: ExtensionContext,
    requestedTheme: string,
    fallbackTheme: string,
    warnedMissingThemes: Set<string>,
): string {
    if (ctx.ui.getTheme(requestedTheme)) {
        return requestedTheme;
    }

    const warningKey = `${requestedTheme}=>${fallbackTheme}`;
    if (!warnedMissingThemes.has(warningKey)) {
        warnedMissingThemes.add(warningKey);
        console.warn(
            `[pi-system-theme] Theme "${requestedTheme}" is not available. Falling back to "${fallbackTheme}".`,
        );
    }

    if (ctx.ui.getTheme(fallbackTheme)) {
        return fallbackTheme;
    }

    return requestedTheme;
}

function warnSetThemeFailureOnce(
    warningKey: string,
    warnings: Set<string>,
    themeName: string,
    errorMessage: string,
): void {
    if (warnings.has(warningKey)) return;

    warnings.add(warningKey);
    console.warn(`[pi-system-theme] Failed to set theme "${themeName}": ${errorMessage}`);
}

async function promptStringSetting(
    ctx: ExtensionCommandContext,
    label: string,
    currentValue: string,
): Promise<string | undefined> {
    const value = await ctx.ui.input(`${label} (current: ${currentValue})`, currentValue);
    if (value === undefined) return undefined;

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : currentValue;
}

async function promptIntegerSetting(
    ctx: ExtensionCommandContext,
    label: string,
    currentValue: number,
    minimum: number,
): Promise<number | undefined> {
    while (true) {
        const value = await ctx.ui.input(`${label} (current: ${currentValue})`, String(currentValue));
        if (value === undefined) return undefined;

        const trimmed = value.trim();
        if (trimmed.length === 0) return currentValue;

        const parsed = Number.parseInt(trimmed, 10);
        if (Number.isFinite(parsed) && parsed >= minimum) {
            return parsed;
        }

        ctx.ui.notify(`Enter a whole number >= ${minimum}, or leave blank to keep current value.`, "warning");
    }
}

export default function systemThemeExtension(pi: ExtensionAPI): void {
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let syncInProgress = false;
    let lastAppliedThemeName: string | undefined;
    let activeConfig: Config = DEFAULT_CONFIG;

    const missingThemeWarnings = new Set<string>();
    const setThemeWarnings = new Set<string>();

    async function syncTheme(ctx: ExtensionContext): Promise<void> {
        if (syncInProgress) return;
        syncInProgress = true;

        try {
            const appearance = await detectAppearance();
            if (appearance === "unknown") return;

            const requestedTheme = getRequestedTheme(activeConfig, appearance);
            const fallbackTheme = getBuiltinFallbackTheme(appearance);
            const targetTheme = resolveThemeName(ctx, requestedTheme, fallbackTheme, missingThemeWarnings);

            const activeThemeName = ctx.ui.theme.name ?? lastAppliedThemeName;
            if (activeThemeName === targetTheme) {
                lastAppliedThemeName = activeThemeName;
                return;
            }

            const setResult = ctx.ui.setTheme(targetTheme);
            if (setResult.success) {
                lastAppliedThemeName = targetTheme;
                return;
            }

            warnSetThemeFailureOnce(
                `set:${targetTheme}`,
                setThemeWarnings,
                targetTheme,
                setResult.error ?? "unknown error",
            );

            if (targetTheme === fallbackTheme) return;

            const fallbackResult = ctx.ui.setTheme(fallbackTheme);
            if (fallbackResult.success) {
                lastAppliedThemeName = fallbackTheme;
                return;
            }

            warnSetThemeFailureOnce(
                `fallback:${fallbackTheme}`,
                setThemeWarnings,
                fallbackTheme,
                fallbackResult.error ?? "unknown error",
            );
        } finally {
            syncInProgress = false;
        }
    }

    function restartPolling(ctx: ExtensionContext): void {
        if (intervalId) {
            clearInterval(intervalId);
        }

        intervalId = setInterval(() => {
            void syncTheme(ctx);
        }, activeConfig.pollMs);
    }

    pi.registerCommand("system-theme", {
        description: "Configure global pi-system-theme settings",
        handler: async (_args, ctx) => {
            if (process.platform !== "darwin") {
                ctx.ui.notify("pi-system-theme currently supports macOS only.", "info");
                return;
            }

            const darkTheme = await promptStringSetting(ctx, "Dark theme", activeConfig.darkTheme);
            if (darkTheme === undefined) return;

            const lightTheme = await promptStringSetting(ctx, "Light theme", activeConfig.lightTheme);
            if (lightTheme === undefined) return;

            const pollMs = await promptIntegerSetting(ctx, "Poll interval (ms)", activeConfig.pollMs, MIN_POLL_MS);
            if (pollMs === undefined) return;

            activeConfig = mergeConfig(DEFAULT_CONFIG, {
                darkTheme,
                lightTheme,
                pollMs,
            });

            try {
                const result = await writeGlobalOverrides(activeConfig);
                if (result.wroteFile) {
                    ctx.ui.notify(`Saved ${result.overrideCount} override(s) to ${GLOBAL_CONFIG_PATH}.`, "info");
                } else {
                    ctx.ui.notify("No overrides left. Removed global config file; defaults are active.", "info");
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                ctx.ui.notify(`Failed to save config: ${message}`, "error");
                return;
            }

            await syncTheme(ctx);
            restartPolling(ctx);
        },
    });

    pi.on("session_start", async (_event, ctx) => {
        if (process.platform !== "darwin") return;

        activeConfig = await loadConfig();
        lastAppliedThemeName = ctx.ui.theme.name;

        await syncTheme(ctx);
        restartPolling(ctx);
    });

    pi.on("session_shutdown", () => {
        if (!intervalId) return;

        clearInterval(intervalId);
        intervalId = null;
    });
}
