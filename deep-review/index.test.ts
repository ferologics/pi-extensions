import { beforeAll, describe, expect, it, vi } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";

vi.mock("@mariozechner/pi-ai", () => ({
    calculateCost: vi.fn(),
    getModel: vi.fn(),
}));

vi.mock("@mariozechner/pi-coding-agent", () => ({
    getMarkdownTheme: vi.fn(() => ({})),
}));

vi.mock("@mariozechner/pi-tui", () => ({
    Markdown: class {},
}));

let splitArgs: (input: string, platform?: NodeJS.Platform) => string[];
let parseOptions: (
    rawArgs: string,
    cwd: string,
) => { ok: boolean; message?: string; options?: { contextPackBudget?: number; contextPackPath?: string } };
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
    modelRatioInputBudget?: number;
};
let extractContextPackPath: (output: string) => Promise<string | undefined>;
let normalizeSectionLikeBoldMarkdown: (markdown: string) => string;
let parseSseStream: (
    body: ReadableStream<Uint8Array>,
) => AsyncGenerator<{ type?: string; [key: string]: unknown }, void, void>;

beforeAll(async () => {
    const mod = await import("./index.js");
    splitArgs = mod.splitArgs;
    parseOptions = mod.parseOptions;
    buildContextPackBudgetPlan = mod.buildContextPackBudgetPlan;
    extractContextPackPath = mod.extractContextPackPath;
    normalizeSectionLikeBoldMarkdown = mod.normalizeSectionLikeBoldMarkdown;
    parseSseStream = mod.parseSseStream;
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

    it("parses --budget and stores contextPackBudget", () => {
        const parsed = parseOptions('"review this" --budget 180000', "/tmp");
        expect(parsed.ok).toBe(true);
        expect(parsed.options?.contextPackBudget).toBe(180000);
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
