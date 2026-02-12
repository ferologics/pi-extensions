import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";

const execFileAsync = promisify(execFile);

type Config = {
    darkTheme: string;
    lightTheme: string;
    pollMs: number;
};

type Appearance = "dark" | "light";

const DEFAULT_CONFIG: Config = {
    darkTheme: "dark",
    lightTheme: "light",
    pollMs: 2000,
};

const GLOBAL_CONFIG_PATH = path.join(os.homedir(), ".pi", "agent", "system-theme.json");
const DETECTION_TIMEOUT_MS = 1200;
const MIN_POLL_MS = 500;

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toThemeName(value: unknown, fallback: string): string {
    if (typeof value !== "string") {
        return fallback;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : fallback;
}

function toPollMs(value: unknown, fallback: number): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return fallback;
    }

    return Math.max(MIN_POLL_MS, Math.round(value));
}

function getOverrides(config: Config): Partial<Config> {
    const overrides: Partial<Config> = {};

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

async function loadConfig(): Promise<Config> {
    const config = { ...DEFAULT_CONFIG };

    try {
        const rawContent = await readFile(GLOBAL_CONFIG_PATH, "utf8");
        const parsed = JSON.parse(rawContent) as unknown;

        if (!isObject(parsed)) {
            console.warn(`[pi-system-theme] Ignoring ${GLOBAL_CONFIG_PATH}: expected JSON object.`);
            return config;
        }

        config.darkTheme = toThemeName(parsed.darkTheme, config.darkTheme);
        config.lightTheme = toThemeName(parsed.lightTheme, config.lightTheme);
        config.pollMs = toPollMs(parsed.pollMs, config.pollMs);

        return config;
    } catch (error) {
        if ((error as { code?: string })?.code === "ENOENT") {
            return config;
        }

        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[pi-system-theme] Failed to read ${GLOBAL_CONFIG_PATH}: ${message}`);
        return config;
    }
}

async function saveConfig(config: Config): Promise<{ wroteFile: boolean; overrideCount: number }> {
    const overrides = getOverrides(config);
    const overrideCount = Object.keys(overrides).length;

    if (overrideCount === 0) {
        await rm(GLOBAL_CONFIG_PATH, { force: true });
        return {
            wroteFile: false,
            overrideCount,
        };
    }

    await mkdir(path.dirname(GLOBAL_CONFIG_PATH), { recursive: true });
    await writeFile(GLOBAL_CONFIG_PATH, `${JSON.stringify(overrides, null, 4)}\n`, "utf8");

    return {
        wroteFile: true,
        overrideCount,
    };
}

function extractStderr(error: unknown): string {
    if (!error || typeof error !== "object") {
        return "";
    }

    const stderr = (error as { stderr?: unknown }).stderr;
    return typeof stderr === "string" ? stderr : "";
}

async function detectAppearance(): Promise<Appearance | null> {
    try {
        const { stdout } = await execFileAsync("/usr/bin/defaults", ["read", "-g", "AppleInterfaceStyle"], {
            timeout: DETECTION_TIMEOUT_MS,
            windowsHide: true,
        });

        const normalized = stdout.trim().toLowerCase();
        if (normalized === "dark") {
            return "dark";
        }

        if (normalized === "light") {
            return "light";
        }

        return null;
    } catch (error) {
        const stderr = extractStderr(error).toLowerCase();
        if (stderr.includes("does not exist")) {
            return "light";
        }

        return null;
    }
}

async function promptTheme(
    ctx: ExtensionCommandContext,
    label: string,
    currentValue: string,
): Promise<string | undefined> {
    const next = await ctx.ui.input(label, currentValue);
    if (next === undefined) {
        return undefined;
    }

    const trimmed = next.trim();
    return trimmed.length > 0 ? trimmed : currentValue;
}

async function promptPollMs(ctx: ExtensionCommandContext, currentValue: number): Promise<number | undefined> {
    while (true) {
        const next = await ctx.ui.input("Poll interval (ms)", String(currentValue));
        if (next === undefined) {
            return undefined;
        }

        const trimmed = next.trim();
        if (trimmed.length === 0) {
            return currentValue;
        }

        const parsed = Number.parseInt(trimmed, 10);
        if (Number.isFinite(parsed) && parsed >= MIN_POLL_MS) {
            return parsed;
        }

        ctx.ui.notify(`Enter a whole number >= ${MIN_POLL_MS}.`, "warning");
    }
}

function canManageThemes(ctx: ExtensionContext): boolean {
    if (!ctx.hasUI) {
        return false;
    }

    return ctx.ui.getAllThemes().length > 0;
}

export default function systemThemeExtension(pi: ExtensionAPI): void {
    let activeConfig: Config = { ...DEFAULT_CONFIG };
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let syncInProgress = false;
    let lastSetThemeError: string | null = null;

    async function syncTheme(ctx: ExtensionContext): Promise<void> {
        if (!canManageThemes(ctx) || syncInProgress) {
            return;
        }

        syncInProgress = true;

        try {
            const appearance = await detectAppearance();
            if (!appearance) {
                return;
            }

            const targetTheme = appearance === "dark" ? activeConfig.darkTheme : activeConfig.lightTheme;
            if (ctx.ui.theme.name === targetTheme) {
                return;
            }

            const result = ctx.ui.setTheme(targetTheme);
            if (result.success) {
                lastSetThemeError = null;
                return;
            }

            const message = result.error ?? "unknown error";
            const errorKey = `${targetTheme}:${message}`;
            if (errorKey !== lastSetThemeError) {
                lastSetThemeError = errorKey;
                console.warn(`[pi-system-theme] Failed to set theme "${targetTheme}": ${message}`);
            }
        } finally {
            syncInProgress = false;
        }
    }

    function restartPolling(ctx: ExtensionContext): void {
        if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
        }

        if (!canManageThemes(ctx)) {
            return;
        }

        intervalId = setInterval(() => {
            void syncTheme(ctx);
        }, activeConfig.pollMs);
    }

    pi.registerCommand("system-theme", {
        description: "Configure pi-system-theme",
        handler: async (_args, ctx) => {
            if (process.platform !== "darwin") {
                if (ctx.hasUI) {
                    ctx.ui.notify("pi-system-theme currently supports macOS only.", "info");
                }
                return;
            }

            if (!canManageThemes(ctx)) {
                if (ctx.hasUI) {
                    ctx.ui.notify("pi-system-theme settings require interactive theme support.", "info");
                }
                return;
            }

            const draft: Config = { ...activeConfig };

            while (true) {
                const darkOption = `Dark theme: ${draft.darkTheme}`;
                const lightOption = `Light theme: ${draft.lightTheme}`;
                const pollOption = `Poll interval (ms): ${draft.pollMs}`;
                const saveOption = "Save and apply";
                const cancelOption = "Cancel";

                const choice = await ctx.ui.select("pi-system-theme", [
                    darkOption,
                    lightOption,
                    pollOption,
                    saveOption,
                    cancelOption,
                ]);

                if (choice === undefined || choice === cancelOption) {
                    return;
                }

                if (choice === darkOption) {
                    const next = await promptTheme(ctx, "Dark theme", draft.darkTheme);
                    if (next !== undefined) {
                        draft.darkTheme = next;
                    }
                    continue;
                }

                if (choice === lightOption) {
                    const next = await promptTheme(ctx, "Light theme", draft.lightTheme);
                    if (next !== undefined) {
                        draft.lightTheme = next;
                    }
                    continue;
                }

                if (choice === pollOption) {
                    const next = await promptPollMs(ctx, draft.pollMs);
                    if (next !== undefined) {
                        draft.pollMs = next;
                    }
                    continue;
                }

                if (choice === saveOption) {
                    activeConfig = draft;

                    try {
                        const result = await saveConfig(activeConfig);
                        if (result.wroteFile) {
                            ctx.ui.notify(
                                `Saved ${result.overrideCount} override(s) to ${GLOBAL_CONFIG_PATH}.`,
                                "info",
                            );
                        } else {
                            ctx.ui.notify("No overrides left. Using defaults.", "info");
                        }
                    } catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        ctx.ui.notify(`Failed to save config: ${message}`, "error");
                        return;
                    }

                    await syncTheme(ctx);
                    restartPolling(ctx);
                    return;
                }
            }
        },
    });

    pi.on("session_start", async (_event, ctx) => {
        if (process.platform !== "darwin" || !canManageThemes(ctx)) {
            return;
        }

        activeConfig = await loadConfig();
        await syncTheme(ctx);
        restartPolling(ctx);
    });

    pi.on("session_shutdown", () => {
        if (!intervalId) {
            return;
        }

        clearInterval(intervalId);
        intervalId = null;
    });
}
