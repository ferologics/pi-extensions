import { beforeAll, describe, expect, it, vi } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";

vi.mock("@earendil-works/pi-ai", () => ({
    calculateCost: vi.fn(),
    getModel: vi.fn(),
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({
    getMarkdownTheme: vi.fn(() => ({})),
}));

vi.mock("@earendil-works/pi-tui", () => ({
    Markdown: class {},
}));

let splitArgs: (input: string, platform?: NodeJS.Platform) => string[];
let parseOptions: (
    rawArgs: string,
    cwd: string,
) => {
    ok: boolean;
    message?: string;
    options?: {
        contextPackBudget?: number;
        contextPackPath?: string;
        effort?: string;
        model?: string;
        provider?: string;
        verbosity?: string;
    };
};
let buildContextPackBudgetPlan: (
    options: { query: string; model: string; contextPackBudget?: number },
    model?: any,
) => {
    source: "manual" | "model-auto" | "default";
    requestedBudget: number;
    finalBudget: number;
    inputFraction?: number;
    modelContextWindow?: number;
    modelHardInputBudget?: number;
    modelCappedRequestedBudget?: number;
    modelRatioInputBudget?: number;
};
let extractContextPackPath: (output: string) => Promise<string | undefined>;
let normalizeSectionLikeBoldMarkdown: (markdown: string) => string;
let parseSseStream: (
    body: ReadableStream<Uint8Array>,
) => AsyncGenerator<{ type?: string; [key: string]: unknown }, void, void>;
let buildResponsesPayload: (options: any, contextText: string, route: any) => Record<string, unknown>;

beforeAll(async () => {
    const mod = await import("./index.js");
    splitArgs = mod.splitArgs;
    parseOptions = mod.parseOptions;
    buildContextPackBudgetPlan = mod.buildContextPackBudgetPlan;
    extractContextPackPath = mod.extractContextPackPath;
    normalizeSectionLikeBoldMarkdown = mod.normalizeSectionLikeBoldMarkdown;
    parseSseStream = mod.parseSseStream;
    buildResponsesPayload = mod.buildResponsesPayload;
});

describe("splitArgs", () => {
    it("keeps Windows backslashes on win32", () => {
        const tokens = splitArgs('--project C:\\repo --query "review"', "win32");
        expect(tokens).toEqual(["--project", "C:\\repo", "--query", "review"]);
    });

    it("supports escaped spaces on posix", () => {
        const tokens = splitArgs("--project /tmp/my\\ repo --query test", "darwin");
        expect(tokens).toEqual(["--project", "/tmp/my repo", "--query", "test"]);
    });
});

describe("parseOptions", () => {
    it("rejects positional + --query together", () => {
        const parsed = parseOptions('positional --query "flag"', "/tmp");
        expect(parsed.ok).toBe(false);
        expect(parsed.message).toContain("both positionally and via --query");
    });

    it("defaults to openai-codex gpt-5.5 on xhigh", () => {
        const parsed = parseOptions('"review this"', "/tmp");
        expect(parsed.ok).toBe(true);
        expect(parsed.options?.provider).toBe("openai-codex");
        expect(parsed.options?.model).toBe("gpt-5.5");
        expect(parsed.options?.effort).toBe("xhigh");
        expect(parsed.options?.verbosity).toBe("medium");
    });

    it("keeps medium verbosity defaults on non-pro models", () => {
        const parsed = parseOptions('"review this" --model gpt-5.2', "/tmp");
        expect(parsed.ok).toBe(true);
        expect(parsed.options?.verbosity).toBe("medium");
    });

    it("defaults to high verbosity on pro models", () => {
        const parsed = parseOptions('"review this" --provider openai --model gpt-5.5-pro', "/tmp");
        expect(parsed.ok).toBe(true);
        expect(parsed.options?.provider).toBe("openai");
        expect(parsed.options?.verbosity).toBe("high");
    });

    it("preserves explicit verbosity overrides regardless of model", () => {
        const parsed = parseOptions('"review this" --verbosity low --model gpt-5.5-pro', "/tmp");
        expect(parsed.ok).toBe(true);
        expect(parsed.options?.verbosity).toBe("low");
    });

    it("parses --budget and stores contextPackBudget", () => {
        const parsed = parseOptions('"review this" --budget 180000', "/tmp");
        expect(parsed.ok).toBe(true);
        expect(parsed.options?.contextPackBudget).toBe(180000);
    });

    it("rejects invalid providers", () => {
        const parsed = parseOptions('"review this" --provider nope', "/tmp");
        expect(parsed.ok).toBe(false);
        expect(parsed.message).toContain("Invalid provider");
    });

    it("parses --context-pack and resolves it against cwd", () => {
        const parsed = parseOptions('"review this" --context-pack packs/pr-context.txt', "/tmp/repo");
        expect(parsed.ok).toBe(true);
        expect(parsed.options?.contextPackPath).toBe(path.resolve("/tmp/repo", "packs/pr-context.txt"));
    });

    it("rejects invalid --budget values", () => {
        const parsed = parseOptions('"review this" --budget nope', "/tmp");
        expect(parsed.ok).toBe(false);
        expect(parsed.message).toContain("Invalid budget");
    });

    it("rejects combining --context-pack with --budget", () => {
        const parsed = parseOptions('"review this" --context-pack pack.txt --budget 120000', "/tmp/repo");
        expect(parsed.ok).toBe(false);
        expect(parsed.message).toContain("cannot be combined with --budget");
    });
});

describe("buildContextPackBudgetPlan", () => {
    it("uses manual override budget when provided", () => {
        const plan = buildContextPackBudgetPlan({ query: "review", model: "gpt-5.4-pro", contextPackBudget: 180000 });
        expect(plan.source).toBe("manual");
        expect(plan.requestedBudget).toBe(180000);
        expect(plan.finalBudget).toBeLessThan(180000);
    });

    it("caps manual override budget at the model hard input limit", () => {
        const plan = buildContextPackBudgetPlan(
            { query: "review", model: "gpt-5.5", contextPackBudget: 800000 },
            {
                provider: "openai-codex",
                id: "gpt-5.5",
                contextWindow: 272000,
                maxTokens: 128000,
            },
        );

        expect(plan.source).toBe("manual");
        expect(plan.requestedBudget).toBe(800000);
        expect(plan.modelCappedRequestedBudget).toBe(144000);
        expect(plan.finalBudget).toBe(129952);
    });

    it("preserves the old 400k/128k input ceiling behavior", () => {
        const plan = buildContextPackBudgetPlan(
            { query: "review", model: "gpt-5.2" },
            {
                provider: "openai",
                id: "gpt-5.2",
                contextWindow: 400000,
                maxTokens: 128000,
            },
        );

        expect(plan.source).toBe("model-auto");
        expect(plan.inputFraction).toBe(0.75);
        expect(plan.modelHardInputBudget).toBe(272000);
        expect(plan.modelRatioInputBudget).toBe(300000);
        expect(plan.requestedBudget).toBe(272000);
        expect(plan.finalBudget).toBe(257952);
    });

    it("normalizes stale gpt-5.4 metadata to the pro-class context window", () => {
        const plan = buildContextPackBudgetPlan(
            { query: "review", model: "gpt-5.4" },
            {
                provider: "openai",
                id: "gpt-5.4",
                contextWindow: 272000,
                maxTokens: 128000,
            },
        );

        expect(plan.source).toBe("model-auto");
        expect(plan.modelContextWindow).toBe(1050000);
        expect(plan.modelHardInputBudget).toBe(922000);
        expect(plan.modelRatioInputBudget).toBe(787500);
        expect(plan.requestedBudget).toBe(787500);
        expect(plan.finalBudget).toBe(773452);
    });

    it("scales up on gpt-5.4-pro without saturating the full context window", () => {
        const plan = buildContextPackBudgetPlan(
            { query: "review", model: "gpt-5.4-pro" },
            {
                provider: "openai",
                id: "gpt-5.4-pro",
                contextWindow: 1100000,
                maxTokens: 128000,
            },
        );

        expect(plan.source).toBe("model-auto");
        expect(plan.modelContextWindow).toBe(1100000);
        expect(plan.modelHardInputBudget).toBe(972000);
        expect(plan.modelRatioInputBudget).toBe(825000);
        expect(plan.requestedBudget).toBe(825000);
        expect(plan.finalBudget).toBe(810952);
    });
});

describe("extractContextPackPath", () => {
    it("returns an existing candidate path", async () => {
        const dir = await mkdtemp(path.join(os.tmpdir(), "deep-review-test-"));
        const realPath = path.join(dir, "pr-context.txt");
        await writeFile(realPath, "test", "utf8");

        const output = `Output: /nope/pr-context.txt\nOutput: ${realPath}`;
        const extracted = await extractContextPackPath(output);

        expect(extracted).toBe(realPath);
    });
});

describe("normalizeSectionLikeBoldMarkdown", () => {
    it("converts standalone bold lines to headings", () => {
        const input = "**Overview**\nBody text";
        const output = normalizeSectionLikeBoldMarkdown(input);
        expect(output).toContain("### Overview");
        expect(output).toContain("Body text");
    });
});

describe("buildResponsesPayload", () => {
    const baseOptions = {
        query: "review this",
        projectDir: "/tmp/repo",
        provider: "openai-codex",
        model: "gpt-5.5",
        effort: "minimal",
        verbosity: "medium",
        summary: "auto",
        debug: false,
    };

    it("includes required Codex instructions", () => {
        const payload = buildResponsesPayload(baseOptions, "context", {
            provider: "openai-codex",
            endpoint: "https://chatgpt.com/backend-api/codex/responses",
            headers: {},
            source: "test",
            model: { provider: "openai-codex", id: "gpt-5.5" },
        });

        expect(payload.instructions).toEqual(expect.stringContaining("senior code reviewer"));
        expect(payload.tool_choice).toBe("auto");
        expect(payload.parallel_tool_calls).toBe(true);
    });
});

describe("parseSseStream", () => {
    it("parses JSON SSE events and ignores DONE", async () => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(encoder.encode('data: {"type":"response.created"}\n\n'));
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                controller.close();
            },
        });

        const events: Array<{ type?: string }> = [];
        for await (const event of parseSseStream(stream)) {
            events.push(event);
        }

        expect(events).toHaveLength(1);
        expect(events[0].type).toBe("response.created");
    });
});
