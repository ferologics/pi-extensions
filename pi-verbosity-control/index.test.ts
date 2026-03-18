import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Api, Model } from "@mariozechner/pi-ai";
import { visibleWidth } from "@mariozechner/pi-tui";

import {
    buildFooterRightSideCandidates,
    cycleVerbosity,
    getExactModelKey,
    injectVerbosityIntoFooterLine,
    loadConfig,
    patchPayloadVerbosity,
    resolveConfiguredVerbosity,
    saveConfig,
    type VerbosityConfig,
} from "./index.js";

const originalHome = process.env.HOME;
let testHome = "";

beforeAll(async () => {
    testHome = await mkdtemp(path.join(os.tmpdir(), "pi-verbosity-control-test-"));
    process.env.HOME = testHome;
});

beforeEach(async () => {
    await rm(path.join(testHome, ".pi"), { recursive: true, force: true });
});

afterAll(async () => {
    await rm(testHome, { recursive: true, force: true });

    if (originalHome === undefined) {
        delete process.env.HOME;
    } else {
        process.env.HOME = originalHome;
    }
});

function createModel(overrides?: Partial<Model<Api>>): Model<Api> {
    return {
        id: "gpt-5.4",
        name: "GPT-5.4",
        provider: "openai-codex",
        api: "openai-codex-responses",
        baseUrl: "https://chatgpt.com/backend-api",
        reasoning: true,
        input: ["text"],
        cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
        },
        contextWindow: 272000,
        maxTokens: 128000,
        ...overrides,
    };
}

describe("pi-verbosity-control helpers", () => {
    it("cycles verbosity in a loop", () => {
        expect(cycleVerbosity(undefined)).toBe("low");
        expect(cycleVerbosity("low")).toBe("medium");
        expect(cycleVerbosity("medium")).toBe("high");
        expect(cycleVerbosity("high")).toBe("low");
    });

    it("prefers exact provider/model matches over bare model ids", () => {
        const model = createModel();
        const config: VerbosityConfig = {
            models: {
                "gpt-5.4": "low",
                "openai-codex/gpt-5.4": "high",
            },
        };

        expect(resolveConfiguredVerbosity(config, model)).toEqual({
            key: "openai-codex/gpt-5.4",
            verbosity: "high",
        });
    });

    it("patches payload text verbosity without dropping existing text fields", () => {
        const payload = {
            model: "gpt-5.4",
            text: {
                format: "plain",
            },
        };

        expect(patchPayloadVerbosity(payload, "low")).toEqual({
            model: "gpt-5.4",
            text: {
                format: "plain",
                verbosity: "low",
            },
        });
    });

    it("builds footer candidates with and without provider prefix", () => {
        expect(buildFooterRightSideCandidates(createModel(), "xhigh")).toEqual([
            "(openai-codex) gpt-5.4 • xhigh",
            "gpt-5.4 • xhigh",
        ]);
    });

    it("injects verbosity into the footer line by consuming padding", () => {
        const line = "↑1.2k ↓3.4k          (openai-codex) gpt-5.4 • xhigh";

        expect(injectVerbosityIntoFooterLine(line, createModel(), "xhigh", "low")).toBe(
            "↑1.2k ↓3.4k (openai-codex) gpt-5.4 • xhigh • 🗣  low",
        );
    });

    it("keeps the footer width stable when space is tight", () => {
        const line = "stats  gpt-5.4 • xhigh";
        const nextLine = injectVerbosityIntoFooterLine(line, createModel(), "xhigh", "low");

        expect(visibleWidth(nextLine)).toBe(visibleWidth(line));
        expect(nextLine).toContain("gpt-5.4 • xhigh •");
    });
});

describe("pi-verbosity-control config io", () => {
    it("loads missing config as empty", async () => {
        await expect(loadConfig()).resolves.toEqual({ models: {} });
    });

    it("saves config with pretty JSON", async () => {
        const config: VerbosityConfig = {
            models: {
                "gpt-5.4": "low",
            },
        };

        await saveConfig(config);

        const raw = await readFile(path.join(testHome, ".pi", "agent", "verbosity.json"), "utf8");
        expect(raw).toBe(`{
    "models": {
        "gpt-5.4": "low"
    }
}\n`);
    });

    it("ignores invalid config values and keeps valid ones", async () => {
        const configPath = path.join(testHome, ".pi", "agent", "verbosity.json");
        await mkdir(path.dirname(configPath), { recursive: true });
        await writeFile(
            configPath,
            `${JSON.stringify(
                {
                    models: {
                        "gpt-5.4": "LOW",
                        "openai-codex/gpt-5.4": "banana",
                        "": "medium",
                    },
                },
                null,
                4,
            )}\n`,
            "utf8",
        );

        await expect(loadConfig()).resolves.toEqual({
            models: {
                "gpt-5.4": "low",
            },
        });
    });

    it("builds the expected exact model key", () => {
        expect(getExactModelKey(createModel())).toBe("openai-codex/gpt-5.4");
    });
});

async function createRuntime(config: VerbosityConfig) {
    await saveConfig(config);

    const { default: verbosityControlExtension } = await import("./index.js");

    let sessionStartHandler: ((event: unknown, ctx: TestContext) => Promise<void> | void) | undefined;
    let beforeProviderRequestHandler: ((event: { payload: unknown }, ctx: TestContext) => unknown) | undefined;
    let shortcutHandler: ((ctx: TestContext) => Promise<void> | void) | undefined;

    const pi = {
        on: (event: string, handler: (event: unknown, ctx: TestContext) => Promise<void> | void) => {
            if (event === "session_start") {
                sessionStartHandler = handler;
            }
            if (event === "before_provider_request") {
                beforeProviderRequestHandler = handler as (event: { payload: unknown }, ctx: TestContext) => unknown;
            }
        },
        registerShortcut: (_shortcut: string, options: { handler: (ctx: TestContext) => Promise<void> | void }) => {
            shortcutHandler = options.handler;
        },
    };

    verbosityControlExtension(pi as never);

    if (!sessionStartHandler || !beforeProviderRequestHandler || !shortcutHandler) {
        throw new Error("Extension did not register expected handlers");
    }

    return {
        sessionStartHandler,
        beforeProviderRequestHandler,
        shortcutHandler,
    };
}

type TestContext = {
    hasUI: boolean;
    model: Model<Api> | undefined;
    ui: {
        theme: {
            fg: (color: string, text: string) => string;
        };
        notify: (message: string, level?: string) => void;
        setStatus: (key: string, text: string | undefined) => void;
    };
};

function createContext(model: Model<Api>): {
    ctx: TestContext;
    notifyMock: ReturnType<typeof vi.fn>;
    setStatusMock: ReturnType<typeof vi.fn>;
} {
    const notifyMock = vi.fn();
    const setStatusMock = vi.fn();

    return {
        ctx: {
            hasUI: true,
            model,
            ui: {
                theme: {
                    fg: (_color: string, text: string) => text,
                },
                notify: notifyMock,
                setStatus: setStatusMock,
            },
        },
        notifyMock,
        setStatusMock,
    };
}

describe("pi-verbosity-control runtime", () => {
    it("patches requests for configured models after session start", async () => {
        const runtime = await createRuntime({
            models: {
                "gpt-5.4": "low",
            },
        });
        const { ctx } = createContext(createModel());

        await runtime.sessionStartHandler({}, ctx);

        const patched = runtime.beforeProviderRequestHandler(
            {
                payload: {
                    model: "gpt-5.4",
                    stream: true,
                },
            },
            ctx,
        );

        expect(patched).toEqual({
            model: "gpt-5.4",
            stream: true,
            text: {
                verbosity: "low",
            },
        });
    });

    it("cycles and persists the current model setting from the shortcut", async () => {
        const runtime = await createRuntime({
            models: {
                "gpt-5.4": "low",
            },
        });
        const { ctx, notifyMock, setStatusMock } = createContext(createModel());

        await runtime.sessionStartHandler({}, ctx);
        await runtime.shortcutHandler(ctx);

        const saved = JSON.parse(await readFile(path.join(testHome, ".pi", "agent", "verbosity.json"), "utf8")) as {
            models: Record<string, string>;
        };

        expect(saved.models["gpt-5.4"]).toBe("medium");
        expect(setStatusMock).toHaveBeenLastCalledWith("verbosity", undefined);
        expect(notifyMock).toHaveBeenLastCalledWith("Verbosity for gpt-5.4 → medium", "info");
    });
});
