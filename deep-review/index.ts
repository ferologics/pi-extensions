import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { calculateCost, getModel, type Model, type Usage } from "@earendil-works/pi-ai";
import { getMarkdownTheme, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";
import { buildContextPack, type ContextPackOptions, type ContextPackReportV1 } from "./context-pack/index.js";

type DeepReviewProvider = "openai" | "openai-codex";
type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";
type TextVerbosity = "low" | "medium" | "high";
type ReasoningSummary = "auto" | "detailed" | null;

type DeepReviewOptions = {
    query: string;
    projectDir: string;
    baseRef?: string;
    contextPackPath?: string;
    contextPackBudget?: number;
    provider: DeepReviewProvider;
    model: string;
    effort: ReasoningEffort;
    verbosity: TextVerbosity;
    summary: ReasoningSummary;
    organization?: string;
    projectId?: string;
    debug: boolean;
};

type ContextPackBudgetSource = "manual" | "model-auto" | "default";

type BudgetModelMetadata = Pick<Model<any>, "contextWindow" | "id" | "maxTokens" | "provider">;

export type ContextPackBudgetPlan = {
    source: ContextPackBudgetSource;
    requestedBudget: number;
    finalBudget: number;
    overheadReserveTokens: number;
    queryReserveTokens: number;
    inputFraction?: number;
    modelContextWindow?: number;
    modelHardInputBudget?: number;
    modelMaxTokens?: number;
    modelCappedRequestedBudget?: number;
    modelId?: string;
    modelProvider?: string;
    modelRatioInputBudget?: number;
};

type ParseResult =
    | {
          ok: true;
          options: DeepReviewOptions;
      }
    | {
          ok: false;
          message: string;
      }
    | {
          ok: false;
          help: true;
      };

type ActiveRun = {
    controller: AbortController;
};

type ResponsesResult = {
    responseId?: string;
    request: {
        provider: DeepReviewProvider;
        endpoint: string;
        tokenSource: string;
    };
    answer: string;
    thinking: string;
    usage: {
        inputTokens: number;
        outputTokens: number;
        cachedTokens: number;
        totalTokens: number;
        estimatedCostUsd?: number;
    };
    durationMs: number;
    debugEvents: string[];
    debugPayload?: string;
};

type ClipboardResult = {
    copied: boolean;
    method?: string;
    error?: string;
};

type ResponsesRequestRoute = {
    provider: DeepReviewProvider;
    endpoint: string;
    headers: Record<string, string>;
    source: string;
    model?: Model<any>;
};

type OutputArtifacts = {
    directory: string;
    answerPath: string;
    thinkingPath: string;
    reportPath: string;
    metadataPath: string;
    clipboard: ClipboardResult;
};

type LiveState = {
    startedAt: number;
    phase: "context-pack" | "responses";
    thinking: string;
    answer: string;
    responsesEventCount: number;
    lastResponsesEventType?: string;
    lastRenderAt: number;
};

const HELP_TEXT = `# /deep-review

Build a PR context pack, then send a direct Responses request through OpenAI Codex or OpenAI Platform.

## Usage

/deep-review <query> [options]

A query is required, either as positional text or via \`--query\`.

## Options

- \`--query <text>\`         Review request text (alternative to positional query; cannot combine both)
- \`--project <path>\`       Project dir for context packing (default: current cwd)
- \`--base <ref>\`           Base ref for context pack diff (default: auto-detect)
- \`--context-pack <path>\`  Skip context-pack generation and use an existing pack file
- \`--budget <tokens>\`      Override the auto-sized context-pack budget target (example: \`180000\`; cannot combine with \`--context-pack\`)
- \`--provider <name>\`      \`openai-codex|openai\` (default: \`openai-codex\`)
- \`--model <id>\`           Responses model (default: \`gpt-5.5\`)
  - Common ids: \`gpt-5.5\`, \`gpt-5.4\`, \`gpt-5.2\`, \`gpt-5.5-pro\`, \`gpt-5.4-pro\`, \`gpt-4.1\`
- \`--effort <level>\`       \`minimal|low|medium|high|xhigh\` (default: \`xhigh\`)
- \`--verbosity <level>\`    \`low|medium|high\` (default: \`high\` on pro models, otherwise \`medium\`)
- \`--summary <mode>\`       \`auto|detailed|null\` (default: \`auto\`)
- \`--no-summary\`           Shortcut for \`--summary null\`
- \`--org <id>\`             Override \`openai-organization\` header (OpenAI Platform only)
- \`--project-id <id>\`      Override \`OpenAI-Project\` header (OpenAI Platform only)
- \`--debug\`                Save payload + stream events to /tmp for parity debugging
- \`--help\`                 Show this help

## Model selection

Use \`--provider <name>\` and \`--model <id>\`, for example:

- \`/deep-review "review this"\`
- \`/deep-review "review this" --model gpt-5.4\`
- \`/deep-review "review this" --provider openai --model gpt-5.5-pro\`

Model availability depends on the OpenAI account / token backing the request.

## Stop command

- \`/deep-review-stop\` stops an in-flight run.

## Requirement

- By default, authenticate with \`/login openai-codex\` (ChatGPT Plus/Pro). Use \`--provider openai\` with \`OPENAI_API_KEY\` for Platform.
- \`tokencount\` must be installed and available in \`PATH\`.
- If \`--context-pack <path>\` is provided, deep-review uses that file directly and skips pack generation.
`;

// biome-ignore lint/complexity/useRegexLiterals: control escape sequences are clearer and lint-cleaner via String.raw here.
const ANSI_REGEX = new RegExp(String.raw`\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007]*(?:\u0007|\u001b\\)`, "g");
const WIDGET_TICK_MS = 250;
const SPINNER_FRAME_MS = 100;
const MARKDOWN_THEME = getMarkdownTheme();
const DEFAULT_DEEP_REVIEW_PROVIDER: DeepReviewProvider = "openai-codex";
const DEFAULT_DEEP_REVIEW_MODEL = "gpt-5.5";
const DEEP_REVIEW_INSTRUCTIONS = [
    "You are a meticulous senior code reviewer.",
    "Use the supplied context pack as the source of truth, then answer the user's review request.",
    "Prioritize correctness, regressions, security, data-loss risks, and missing tests.",
    "Call out uncertainty and omitted coverage explicitly instead of pretending the review is exhaustive.",
].join("\n");
const HIGH_VERBOSITY_MODEL_IDS = new Set(["gpt-5.4-pro", "gpt-5.5-pro"]);
const OPENAI_RESPONSES_BASE_URL = "https://api.openai.com/v1";
const OPENAI_CODEX_BASE_URL = "https://chatgpt.com/backend-api";
const CHATGPT_ACCOUNT_ID_CLAIM = "https://api.openai.com/auth";

function stripAnsi(value: string): string {
    return value.replace(ANSI_REGEX, "");
}

function formatDuration(ms: number): string {
    if (ms < 1000) {
        return `${ms}ms`;
    }

    const totalSeconds = ms / 1000;
    if (totalSeconds < 60) {
        return `${totalSeconds.toFixed(1)}s`;
    }

    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return `${minutes}m ${seconds}s`;
}

function describeResponsesEvent(eventType: string): string {
    switch (eventType) {
        case "response.created":
            return "request accepted";
        case "response.in_progress":
            return "model reasoning";
        case "response.output_item.added":
            return "new output block";
        case "response.reasoning_summary_part.added":
            return "thinking started";
        case "response.reasoning_summary_text.delta":
            return "thinking update";
        case "response.output_text.delta":
            return "answer update";
        case "response.output_text.done":
            return "answer block finished";
        case "response.content_part.added":
            return "content part added";
        case "response.completed":
            return "response complete";
        case "error":
            return "stream error";
        default:
            return eventType.startsWith("response.")
                ? eventType.slice("response.".length).replace(/[._]/g, " ")
                : eventType.replace(/[._]/g, " ");
    }
}

async function runClipboardProgram(command: string, args: string[], text: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const child = spawn(command, args, { stdio: ["pipe", "ignore", "pipe"] });
        let stderr = "";

        child.on("error", (error) => {
            reject(error);
        });

        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });

        child.on("close", (code) => {
            if (code === 0) {
                resolve();
                return;
            }

            reject(new Error(stderr.trim() || `${command} exited with code ${code ?? "unknown"}`));
        });

        child.stdin.on("error", () => {
            // Ignore EPIPE and similar shutdown errors.
        });

        child.stdin.end(text);
    });
}

async function copyTextToClipboard(text: string): Promise<ClipboardResult> {
    const payload = text.trim().length > 0 ? text : "(no output text returned)";

    const candidates: Array<{ command: string; args: string[]; method: string }> =
        process.platform === "darwin"
            ? [{ command: "pbcopy", args: [], method: "pbcopy" }]
            : process.platform === "win32"
              ? [{ command: "clip", args: [], method: "clip" }]
              : [
                    { command: "wl-copy", args: [], method: "wl-copy" },
                    { command: "xclip", args: ["-selection", "clipboard"], method: "xclip" },
                    { command: "xsel", args: ["--clipboard", "--input"], method: "xsel" },
                ];

    const errors: string[] = [];

    for (const candidate of candidates) {
        try {
            await runClipboardProgram(candidate.command, candidate.args, payload);
            return { copied: true, method: candidate.method };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            errors.push(`${candidate.method}: ${message}`);
        }
    }

    return {
        copied: false,
        error: errors.length > 0 ? errors.join(" | ") : "No clipboard command available",
    };
}

async function writeOutputArtifacts(
    options: DeepReviewOptions,
    packPath: string,
    responses: ResponsesResult,
    totalDurationMs: number,
    reportContent: string,
    budgetPlan?: ContextPackBudgetPlan,
    debugDir?: string,
): Promise<OutputArtifacts> {
    const directory = await mkdtemp(path.join(os.tmpdir(), "deep-review-output-"));
    const answerPath = path.join(directory, "answer.txt");
    const thinkingPath = path.join(directory, "thinking.txt");
    const reportPath = path.join(directory, "report.md");
    const metadataPath = path.join(directory, "metadata.json");

    const answerText = responses.answer.trim().length > 0 ? responses.answer : "(no output text returned)";
    const thinkingText =
        responses.thinking.trim().length > 0 ? responses.thinking : "(no reasoning summary text returned)";

    await writeFile(answerPath, `${answerText}\n`, "utf8");
    await writeFile(thinkingPath, `${thinkingText}\n`, "utf8");
    await writeFile(reportPath, `${reportContent}\n`, "utf8");

    const metadata = {
        createdAt: new Date().toISOString(),
        query: options.query,
        provider: options.provider,
        model: options.model,
        effort: options.effort,
        summary: options.summary,
        verbosity: options.verbosity,
        contextPackPath: packPath,
        contextPackPathOverride: options.contextPackPath,
        contextPackBudgetOverride: options.contextPackBudget,
        contextPackBudgetPlan: budgetPlan,
        totalDurationMs,
        usage: responses.usage,
        responseId: responses.responseId,
        request: responses.request,
        debugDir,
    };

    await writeFile(metadataPath, `${JSON.stringify(metadata, null, 4)}\n`, "utf8");

    const clipboard = await copyTextToClipboard(answerText);

    return {
        directory,
        answerPath,
        thinkingPath,
        reportPath,
        metadataPath,
        clipboard,
    };
}

export function splitArgs(input: string, platform = process.platform): string[] {
    const tokens: string[] = [];
    let current = "";
    let quote: '"' | "'" | null = null;
    let escaping = false;

    for (const char of input) {
        if (escaping) {
            current += char;
            escaping = false;
            continue;
        }

        if (char === "\\") {
            const shouldEscape = platform !== "win32" || quote !== null;
            if (shouldEscape) {
                escaping = true;
                continue;
            }

            current += char;
            continue;
        }

        if (quote) {
            if (char === quote) {
                quote = null;
            } else {
                current += char;
            }
            continue;
        }

        if (char === '"' || char === "'") {
            quote = char;
            continue;
        }

        if (/\s/.test(char)) {
            if (current.length > 0) {
                tokens.push(current);
                current = "";
            }
            continue;
        }

        current += char;
    }

    if (escaping) {
        current += "\\";
    }

    if (current.length > 0) {
        tokens.push(current);
    }

    return tokens;
}

function normalizeSummary(value: string): ReasoningSummary | undefined {
    const lowered = value.toLowerCase();
    if (lowered === "auto") return "auto";
    if (lowered === "detailed") return "detailed";
    if (lowered === "null" || lowered === "none" || lowered === "off") return null;
    return undefined;
}

function normalizeDeepReviewModelId(modelId: string): string {
    const normalized = modelId.trim().toLowerCase();
    if (!normalized.includes("/")) {
        return normalized;
    }

    return normalized.slice(normalized.lastIndexOf("/") + 1);
}

function defaultVerbosityForModel(modelId: string): TextVerbosity {
    return HIGH_VERBOSITY_MODEL_IDS.has(normalizeDeepReviewModelId(modelId)) ? "high" : "medium";
}

export function parseOptions(rawArgs: string, cwd: string): ParseResult {
    const tokens = splitArgs(rawArgs);

    const options: DeepReviewOptions = {
        query: "",
        projectDir: cwd,
        provider: DEFAULT_DEEP_REVIEW_PROVIDER,
        model: DEFAULT_DEEP_REVIEW_MODEL,
        effort: "xhigh",
        verbosity: defaultVerbosityForModel(DEFAULT_DEEP_REVIEW_MODEL),
        summary: "auto",
        debug: false,
    };

    const positional: string[] = [];
    let explicitVerbosity = false;

    const takeValue = (index: number): string | null => {
        const value = tokens[index + 1];
        if (!value || value.startsWith("--")) {
            return null;
        }
        return value;
    };

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];

        if (token === "--help" || token === "-h") {
            return { ok: false, help: true };
        }

        if (!token.startsWith("--")) {
            positional.push(token);
            continue;
        }

        switch (token) {
            case "--project": {
                const value = takeValue(i);
                if (!value) return { ok: false, message: `${token} requires a value` };
                options.projectDir = value;
                i++;
                break;
            }
            case "--base": {
                const value = takeValue(i);
                if (!value) return { ok: false, message: `${token} requires a value` };
                options.baseRef = value;
                i++;
                break;
            }
            case "--context-pack": {
                const value = takeValue(i);
                if (!value) return { ok: false, message: `${token} requires a value` };
                options.contextPackPath = value;
                i++;
                break;
            }
            case "--budget": {
                const value = takeValue(i);
                if (!value) return { ok: false, message: `${token} requires a value` };

                const normalized = value.replace(/[,_]/g, "");
                const parsedBudget = Number(normalized);

                if (!Number.isSafeInteger(parsedBudget) || parsedBudget <= 0) {
                    return { ok: false, message: `Invalid budget: ${value}` };
                }

                options.contextPackBudget = parsedBudget;
                i++;
                break;
            }
            case "--provider": {
                const value = takeValue(i);
                if (!value) return { ok: false, message: `${token} requires a value` };
                if (!isDeepReviewProvider(value)) {
                    return { ok: false, message: `Invalid provider: ${value}` };
                }
                options.provider = value;
                i++;
                break;
            }
            case "--model": {
                const value = takeValue(i);
                if (!value) return { ok: false, message: `${token} requires a value` };
                options.model = value;
                i++;
                break;
            }
            case "--effort": {
                const value = takeValue(i);
                if (!value) return { ok: false, message: `${token} requires a value` };
                if (!["minimal", "low", "medium", "high", "xhigh"].includes(value)) {
                    return { ok: false, message: `Invalid effort: ${value}` };
                }
                options.effort = value as ReasoningEffort;
                i++;
                break;
            }
            case "--verbosity": {
                const value = takeValue(i);
                if (!value) return { ok: false, message: `${token} requires a value` };
                if (!["low", "medium", "high"].includes(value)) {
                    return { ok: false, message: `Invalid verbosity: ${value}` };
                }
                explicitVerbosity = true;
                options.verbosity = value as TextVerbosity;
                i++;
                break;
            }
            case "--summary": {
                const value = takeValue(i);
                if (!value) return { ok: false, message: `${token} requires a value` };
                const normalized = normalizeSummary(value);
                if (normalized === undefined) {
                    return { ok: false, message: `Invalid summary mode: ${value}` };
                }
                options.summary = normalized;
                i++;
                break;
            }
            case "--no-summary": {
                options.summary = null;
                break;
            }
            case "--org": {
                const value = takeValue(i);
                if (!value) return { ok: false, message: `${token} requires a value` };
                options.organization = value;
                i++;
                break;
            }
            case "--project-id": {
                const value = takeValue(i);
                if (!value) return { ok: false, message: `${token} requires a value` };
                options.projectId = value;
                i++;
                break;
            }
            case "--query": {
                const value = takeValue(i);
                if (!value) return { ok: false, message: `${token} requires a value` };
                options.query = value;
                i++;
                break;
            }
            case "--debug": {
                options.debug = true;
                break;
            }
            default:
                return { ok: false, message: `Unknown option: ${token}` };
        }
    }

    if (positional.length > 0) {
        if (options.query) {
            return {
                ok: false,
                message: "Query provided both positionally and via --query; choose one.",
            };
        }

        options.query = positional.join(" ").trim();
    }

    options.query = options.query.trim();
    if (!explicitVerbosity) {
        options.verbosity = defaultVerbosityForModel(options.model);
    }

    if (!options.query) {
        return {
            ok: false,
            message: 'Query is required. Use /deep-review "..." or pass --query "...".',
        };
    }

    options.projectDir = path.resolve(cwd, options.projectDir);

    if (options.contextPackPath) {
        options.contextPackPath = path.resolve(cwd, options.contextPackPath);
    }

    if (options.contextPackPath && options.contextPackBudget !== undefined) {
        return {
            ok: false,
            message: "--context-pack cannot be combined with --budget (budget only applies when generating a pack).",
        };
    }

    return { ok: true, options };
}

async function pathExists(value: string): Promise<boolean> {
    try {
        await access(value);
        return true;
    } catch {
        return false;
    }
}

function isLikelyContextPackPath(value: string): boolean {
    return value.endsWith(".txt") && (value.includes("pr-context") || value.includes("context-packer"));
}

function rankContextPackCandidate(value: string): number {
    if (value.endsWith("/pr-context.txt") || value.endsWith("\\pr-context.txt")) {
        return 0;
    }
    if (value.includes("/tmp/context-packer/") || value.toLowerCase().includes("\\temp\\context-packer\\")) {
        return 1;
    }
    if (value.includes("pr-context")) {
        return 2;
    }
    return 3;
}

export async function extractContextPackPath(output: string): Promise<string | undefined> {
    const cleaned = stripAnsi(output);
    const candidates: string[] = [];

    const explicitOutputLine = cleaned
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => /^(?:📄\s*)?Output:\s+/i.test(line));

    if (explicitOutputLine) {
        const explicitPath = explicitOutputLine
            .replace(/^(?:📄\s*)?Output:\s+/i, "")
            .trim()
            .replace(/^['"]|['"]$/g, "")
            .replace(/[),.:;]+$/g, "");

        if (isLikelyContextPackPath(explicitPath)) {
            candidates.push(explicitPath);
        }
    }

    const posixMatches = cleaned.match(/\/[\w./-]+\.txt/g) ?? [];
    const winMatches = cleaned.match(/[A-Za-z]:\\[^\s"'<>|?*]+\.txt/g) ?? [];

    for (const match of [...posixMatches, ...winMatches]) {
        const candidate = match.replace(/[),.:;]+$/g, "");
        if (isLikelyContextPackPath(candidate)) {
            candidates.push(candidate);
        }
    }

    const uniqueSortedCandidates = [...new Set(candidates)].sort(
        (left, right) => rankContextPackCandidate(left) - rankContextPackCandidate(right),
    );

    for (const candidate of uniqueSortedCandidates) {
        if (await pathExists(candidate)) {
            return candidate;
        }
    }

    return undefined;
}

function renderLiveWidget(ctx: ExtensionCommandContext, state: LiveState, force = false): void {
    if (!ctx.hasUI) {
        return;
    }

    const now = Date.now();
    if (!force && now - state.lastRenderAt < 120) {
        return;
    }

    state.lastRenderAt = now;

    const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    const spinner = spinnerFrames[Math.floor(now / SPINNER_FRAME_MS) % spinnerFrames.length];

    const lines: string[] = [];
    lines.push(ctx.ui.theme.fg("accent", `${spinner} deep-review · ${state.phase}`));
    lines.push(ctx.ui.theme.fg("dim", `elapsed ${formatDuration(now - state.startedAt)} · /deep-review-stop to stop`));

    if (state.phase === "context-pack") {
        lines.push(ctx.ui.theme.fg("muted", "building context pack…"));
    } else {
        const streamSummary = state.lastResponsesEventType
            ? `${state.responsesEventCount.toLocaleString()} events · ${describeResponsesEvent(state.lastResponsesEventType)}`
            : `${state.responsesEventCount.toLocaleString()} events · waiting for first event`;

        lines.push(ctx.ui.theme.fg("dim", `stream: ${streamSummary}`));

        if (state.answer.trim().length > 0) {
            lines.push(ctx.ui.theme.fg("muted", "answer streaming… full markdown answer posts at completion"));
        } else {
            lines.push(ctx.ui.theme.fg("muted", "reasoning in progress… waiting for answer tokens"));
        }
    }

    lines.push(ctx.ui.theme.fg("dim", "handoff files are written after completion"));

    ctx.ui.setWidget("deep-review-live", lines);
}

type SseEvent = {
    type?: string;
    [key: string]: unknown;
};

function findSseBoundary(buffer: string): { index: number; length: number } | null {
    const rnIndex = buffer.indexOf("\r\n\r\n");
    const nIndex = buffer.indexOf("\n\n");

    if (rnIndex === -1 && nIndex === -1) {
        return null;
    }

    if (rnIndex === -1) {
        return { index: nIndex, length: 2 };
    }

    if (nIndex === -1) {
        return { index: rnIndex, length: 4 };
    }

    return rnIndex < nIndex ? { index: rnIndex, length: 4 } : { index: nIndex, length: 2 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatSseErrorEvent(event: SseEvent): string {
    const error = event.error;

    if (isRecord(error)) {
        const code = typeof error.code === "string" ? error.code : undefined;
        const message = typeof error.message === "string" ? error.message : undefined;
        const param = typeof error.param === "string" ? error.param : undefined;

        return [code, message, param ? `param=${param}` : undefined].filter(Boolean).join(" · ");
    }

    return typeof event.message === "string" ? event.message : JSON.stringify(event);
}

export async function* parseSseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent, void, void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }

        buffer += decoder.decode(value, { stream: true });

        while (true) {
            const boundary = findSseBoundary(buffer);
            if (!boundary) {
                break;
            }

            const rawEvent = buffer.slice(0, boundary.index);
            buffer = buffer.slice(boundary.index + boundary.length);

            const lines = rawEvent.split(/\r?\n/);
            const dataLines: string[] = [];

            for (const line of lines) {
                if (line.startsWith("data:")) {
                    dataLines.push(line.slice(5).trimStart());
                }
            }

            if (dataLines.length === 0) {
                continue;
            }

            const data = dataLines.join("\n");
            if (data === "[DONE]") {
                return;
            }

            try {
                const parsed = JSON.parse(data) as SseEvent;
                yield parsed;
            } catch {
                // Ignore malformed SSE chunks
            }
        }
    }
}

function isDeepReviewProvider(value: string): value is DeepReviewProvider {
    return value === "openai" || value === "openai-codex";
}

function hasAuthorizationHeader(headers: Record<string, string>): boolean {
    return Object.keys(headers).some((key) => key.toLowerCase() === "authorization");
}

function getAuthorizationBearer(headers: Record<string, string> | undefined): string | undefined {
    if (!headers) {
        return undefined;
    }

    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() !== "authorization") {
            continue;
        }

        const match = value.match(/^Bearer\s+(.+)$/i);
        return (match?.[1] ?? value).trim() || undefined;
    }

    return undefined;
}

function withoutAuthorizationHeader(headers: Record<string, string> | undefined): Record<string, string> {
    const result = { ...(headers ?? {}) };
    for (const key of Object.keys(result)) {
        if (key.toLowerCase() === "authorization") {
            delete result[key];
        }
    }
    return result;
}

function resolveRequestModel(
    modelRegistry: ExtensionCommandContext["modelRegistry"],
    provider: DeepReviewProvider,
    modelId: string,
): Model<any> | undefined {
    return (
        (modelRegistry.find(provider, modelId) as Model<any> | undefined) ??
        (getModel(provider, modelId as never) as Model<any> | undefined)
    );
}

function uniqueModelCandidates(candidates: Array<Model<any> | undefined>): Model<any>[] {
    const seen = new Set<string>();
    const result: Model<any>[] = [];

    for (const candidate of candidates) {
        if (!candidate) {
            continue;
        }

        const key = `${candidate.provider}/${candidate.id}`;
        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        result.push(candidate);
    }

    return result;
}

function getAuthModelCandidates(
    modelRegistry: ExtensionCommandContext["modelRegistry"],
    provider: DeepReviewProvider,
    modelId: string,
): Model<any>[] {
    const fallbackIds =
        provider === "openai-codex"
            ? [modelId, DEFAULT_DEEP_REVIEW_MODEL, "gpt-5.4", "gpt-5.2"]
            : [modelId, DEFAULT_DEEP_REVIEW_MODEL, "gpt-5.5-pro", "gpt-5", "gpt-4.1"];

    return uniqueModelCandidates(
        fallbackIds.flatMap((id) => [
            modelRegistry.find(provider, id) as Model<any> | undefined,
            getModel(provider, id as never) as Model<any> | undefined,
        ]),
    );
}

function resolveOpenAiResponsesEndpoint(model?: Model<any>): string {
    const raw = model?.baseUrl?.trim() || OPENAI_RESPONSES_BASE_URL;
    const normalized = raw.replace(/\/+$/, "");
    return normalized.endsWith("/responses") ? normalized : `${normalized}/responses`;
}

function resolveCodexResponsesEndpoint(model?: Model<any>): string {
    const raw = model?.baseUrl?.trim() || OPENAI_CODEX_BASE_URL;
    const normalized = raw.replace(/\/+$/, "");
    if (normalized.endsWith("/codex/responses")) {
        return normalized;
    }
    if (normalized.endsWith("/codex")) {
        return `${normalized}/responses`;
    }
    return `${normalized}/codex/responses`;
}

function extractChatGptAccountId(token: string): string {
    try {
        const payloadPart = token.split(".")[1];
        if (!payloadPart) {
            throw new Error("missing JWT payload");
        }

        const normalizedPayload = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
        const payload = JSON.parse(Buffer.from(normalizedPayload, "base64").toString("utf8")) as {
            [CHATGPT_ACCOUNT_ID_CLAIM]?: { chatgpt_account_id?: unknown };
        };
        const accountId = payload[CHATGPT_ACCOUNT_ID_CLAIM]?.chatgpt_account_id;
        if (typeof accountId !== "string" || accountId.length === 0) {
            throw new Error("missing chatgpt_account_id");
        }

        return accountId;
    } catch {
        throw new Error(
            "OpenAI Codex auth requires a ChatGPT OAuth token with chatgpt-account-id. Run `/login openai-codex`, or use `--provider openai` with OPENAI_API_KEY.",
        );
    }
}

function buildCodexHeaders(
    authHeaders: Record<string, string> | undefined,
    token: string,
    accept: string,
): Record<string, string> {
    const headers = withoutAuthorizationHeader(authHeaders);
    headers.Authorization = `Bearer ${token}`;
    headers["chatgpt-account-id"] = extractChatGptAccountId(token);
    headers.originator = "pi";
    if (!Object.keys(headers).some((key) => key.toLowerCase() === "user-agent")) {
        headers["User-Agent"] = "pi deep-review";
    }
    headers["OpenAI-Beta"] = "responses=experimental";
    headers.Accept = accept;
    headers["Content-Type"] = "application/json";
    return headers;
}

async function resolveOpenAiPlatformRoute(
    ctx: ExtensionCommandContext,
    options: Pick<DeepReviewOptions, "model" | "organization" | "projectId">,
    accept: string,
): Promise<ResponsesRequestRoute> {
    const model = resolveRequestModel(ctx.modelRegistry, "openai", options.model);
    const fromEnv = process.env.OPENAI_API_KEY?.trim();
    if (fromEnv) {
        const headers: Record<string, string> = { Authorization: `Bearer ${fromEnv}` };
        return withOpenAiPlatformHeaders(
            {
                provider: "openai",
                endpoint: resolveOpenAiResponsesEndpoint(model),
                headers,
                source: "OPENAI_API_KEY",
                model,
            },
            options,
            accept,
        );
    }

    for (const candidate of getAuthModelCandidates(ctx.modelRegistry, "openai", options.model)) {
        const auth = await ctx.modelRegistry.getApiKeyAndHeaders(candidate);
        if (!auth.ok) {
            continue;
        }

        const headers = { ...(auth.headers ?? {}) };
        if (!hasAuthorizationHeader(headers) && auth.apiKey) {
            headers.Authorization = `Bearer ${auth.apiKey}`;
        }

        if (hasAuthorizationHeader(headers)) {
            return withOpenAiPlatformHeaders(
                {
                    provider: "openai",
                    endpoint: resolveOpenAiResponsesEndpoint(model ?? candidate),
                    headers,
                    source: `modelRegistry/${candidate.provider}/${candidate.id}`,
                    model: model ?? candidate,
                },
                options,
                accept,
            );
        }
    }

    const bearer = process.env.OPENAI_BEARER_TOKEN?.trim();
    if (bearer) {
        return withOpenAiPlatformHeaders(
            {
                provider: "openai",
                endpoint: resolveOpenAiResponsesEndpoint(model),
                headers: { Authorization: `Bearer ${bearer}` },
                source: "OPENAI_BEARER_TOKEN",
                model,
            },
            options,
            accept,
        );
    }

    throw new Error(
        "No OpenAI Platform token found. Set OPENAI_API_KEY or choose `--provider openai-codex` after `/login openai-codex`.",
    );
}

function withOpenAiPlatformHeaders(
    route: ResponsesRequestRoute,
    options: Pick<DeepReviewOptions, "organization" | "projectId">,
    accept: string,
): ResponsesRequestRoute {
    const organization = options.organization ?? process.env.OPENAI_ORGANIZATION ?? process.env.OPENAI_ORG_ID;
    const projectId = options.projectId ?? process.env.OPENAI_PROJECT ?? process.env.OPENAI_PROJECT_ID;

    const headers: Record<string, string> = {
        ...route.headers,
        "Content-Type": "application/json",
        Accept: accept,
        "openai-beta": "responses=v1",
    };

    if (organization) {
        headers["openai-organization"] = organization;
    }

    if (projectId) {
        headers["OpenAI-Project"] = projectId;
    }

    return { ...route, headers };
}

async function resolveOpenAiCodexRoute(
    ctx: ExtensionCommandContext,
    options: Pick<DeepReviewOptions, "model">,
    accept: string,
): Promise<ResponsesRequestRoute> {
    const model = resolveRequestModel(ctx.modelRegistry, "openai-codex", options.model);

    for (const candidate of getAuthModelCandidates(ctx.modelRegistry, "openai-codex", options.model)) {
        const auth = await ctx.modelRegistry.getApiKeyAndHeaders(candidate);
        if (!auth.ok) {
            continue;
        }

        const token = auth.apiKey?.trim() || getAuthorizationBearer(auth.headers);
        if (!token) {
            continue;
        }

        return {
            provider: "openai-codex",
            endpoint: resolveCodexResponsesEndpoint(model ?? candidate),
            headers: buildCodexHeaders(auth.headers, token, accept),
            source: `modelRegistry/${candidate.provider}/${candidate.id}`,
            model: model ?? candidate,
        };
    }

    const sessionLike = process.env.OPENAI_SESSION_TOKEN?.trim() ?? process.env.OPENAI_BEARER_TOKEN?.trim();
    if (sessionLike) {
        return {
            provider: "openai-codex",
            endpoint: resolveCodexResponsesEndpoint(model),
            headers: buildCodexHeaders(undefined, sessionLike, accept),
            source: "OPENAI_SESSION_TOKEN/OPENAI_BEARER_TOKEN",
            model,
        };
    }

    throw new Error(
        "No OpenAI Codex token found. Run `/login openai-codex` or set OPENAI_SESSION_TOKEN/OPENAI_BEARER_TOKEN.",
    );
}

async function resolveResponsesRoute(
    ctx: ExtensionCommandContext,
    options: Pick<DeepReviewOptions, "model" | "organization" | "projectId" | "provider">,
    accept: string,
): Promise<ResponsesRequestRoute> {
    return options.provider === "openai-codex"
        ? resolveOpenAiCodexRoute(ctx, options, accept)
        : resolveOpenAiPlatformRoute(ctx, options, accept);
}

function resolveReasoningEffort(model: Model<any> | undefined, effort: ReasoningEffort): string {
    const mappedEffort = model?.thinkingLevelMap?.[effort];
    if (mappedEffort === null) {
        const modelLabel = model ? `${model.provider}/${model.id}` : "selected model";
        throw new Error(`Reasoning effort ${effort} is not supported by ${modelLabel}`);
    }
    return mappedEffort ?? effort;
}

export function buildResponsesPayload(
    options: DeepReviewOptions,
    contextText: string,
    route: ResponsesRequestRoute,
): Record<string, unknown> {
    const input = [
        {
            role: "user",
            content: [{ type: "input_text", text: contextText }],
        },
        {
            role: "user",
            content: [{ type: "input_text", text: options.query }],
        },
    ];

    const reasoning = {
        effort: resolveReasoningEffort(route.model, options.effort),
        summary: options.summary,
    };

    if (route.provider === "openai-codex") {
        return {
            model: options.model,
            input,
            instructions: DEEP_REVIEW_INSTRUCTIONS,
            text: {
                verbosity: options.verbosity,
            },
            reasoning,
            include: ["reasoning.encrypted_content"],
            tool_choice: "auto",
            parallel_tool_calls: true,
            stream: true,
            store: false,
        };
    }

    return {
        model: options.model,
        input,
        instructions: DEEP_REVIEW_INSTRUCTIONS,
        tools: [],
        text: {
            format: { type: "text" },
            verbosity: options.verbosity,
        },
        reasoning,
        stream: true,
        store: false,
    };
}

function extractCompletedAnswer(responseObject: any): string {
    const output = Array.isArray(responseObject?.output) ? responseObject.output : [];
    const parts: string[] = [];

    for (const item of output) {
        if (item?.type !== "message" || !Array.isArray(item?.content)) {
            continue;
        }

        for (const content of item.content) {
            if (content?.type === "output_text" && typeof content.text === "string") {
                parts.push(content.text);
            }
            if (content?.type === "refusal" && typeof content.refusal === "string") {
                parts.push(content.refusal);
            }
        }
    }

    return parts.join("\n").trim();
}

async function streamResponses(
    options: DeepReviewOptions,
    contextText: string,
    ctx: ExtensionCommandContext,
    signal: AbortSignal,
    onThinkingDelta: (delta: string) => void,
    onAnswerDelta: (delta: string) => void,
    onEvent: (eventType: string) => void,
): Promise<ResponsesResult> {
    const startedAt = Date.now();
    const route = await resolveResponsesRoute(ctx, options, "text/event-stream");
    const payload = buildResponsesPayload(options, contextText, route);

    const response = await fetch(route.endpoint, {
        method: "POST",
        headers: route.headers,
        body: JSON.stringify(payload),
        signal,
    });

    if (!response.ok || !response.body) {
        const body = await response.text();
        throw new Error(`${route.provider} Responses API failed (${response.status}): ${body}`);
    }

    if (signal.aborted) {
        throw new Error("Request was aborted");
    }

    const debugEvents: string[] = [];
    let thinking = "";
    let answer = "";
    let completedResponse: any;

    for await (const event of parseSseStream(response.body)) {
        if (signal.aborted) {
            throw new Error("Request was aborted");
        }

        if (options.debug) {
            debugEvents.push(JSON.stringify(event));
        }

        const eventType = typeof event.type === "string" ? event.type : "(unknown)";
        onEvent(eventType);

        if (event.type === "response.reasoning_summary_text.delta") {
            const delta = typeof event.delta === "string" ? event.delta : "";
            if (delta) {
                thinking += delta;
                onThinkingDelta(delta);
            }
            continue;
        }

        if (event.type === "response.output_text.delta") {
            const delta = typeof event.delta === "string" ? event.delta : "";
            if (delta) {
                answer += delta;
                onAnswerDelta(delta);
            }
            continue;
        }

        if (
            event.type === "response.completed" ||
            event.type === "response.done" ||
            event.type === "response.incomplete"
        ) {
            completedResponse = event.response;
            continue;
        }

        if (event.type === "response.failed") {
            const responseError = (event.response as any)?.error;
            const message =
                typeof responseError?.message === "string"
                    ? responseError.message
                    : typeof responseError?.code === "string"
                      ? responseError.code
                      : JSON.stringify(event);
            throw new Error(`Responses stream failed: ${message}`);
        }

        if (event.type === "error") {
            throw new Error(`Responses stream error: ${formatSseErrorEvent(event)}`);
        }
    }

    if (!answer.trim() && completedResponse) {
        answer = extractCompletedAnswer(completedResponse);
    }

    const usagePayload = completedResponse?.usage ?? {};
    const inputTokens = Number(usagePayload.input_tokens ?? 0);
    const outputTokens = Number(usagePayload.output_tokens ?? 0);
    const cachedTokens = Number(usagePayload.input_tokens_details?.cached_tokens ?? 0);
    const totalTokens = Number(usagePayload.total_tokens ?? inputTokens + outputTokens);

    let estimatedCostUsd: number | undefined;
    const billingModel = route.model ?? (getModel(options.provider, options.model as never) as Model<any> | undefined);

    if (billingModel) {
        const usage: Usage = {
            input: Math.max(0, inputTokens - cachedTokens),
            output: outputTokens,
            cacheRead: cachedTokens,
            cacheWrite: 0,
            totalTokens,
            cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                total: 0,
            },
        };

        calculateCost(billingModel, usage);
        estimatedCostUsd = usage.cost.total;
    }

    const responseId = typeof completedResponse?.id === "string" ? completedResponse.id : undefined;

    let debugPayload: string | undefined;

    if (options.debug) {
        debugPayload = JSON.stringify(payload, null, 4);

        debugEvents.unshift(
            JSON.stringify({
                type: "request_meta",
                provider: route.provider,
                endpoint: route.endpoint,
                tokenSource: route.source,
                hasOrganizationHeader: "openai-organization" in route.headers,
                hasProjectHeader: "OpenAI-Project" in route.headers,
                payloadMeta: {
                    model: options.model,
                    effort: options.effort,
                    summary: options.summary,
                    verbosity: options.verbosity,
                    contextChars: contextText.length,
                    queryChars: options.query.length,
                },
            }),
        );
    }

    return {
        responseId,
        request: {
            provider: route.provider,
            endpoint: route.endpoint,
            tokenSource: route.source,
        },
        answer,
        thinking,
        usage: {
            inputTokens,
            outputTokens,
            cachedTokens,
            totalTokens,
            estimatedCostUsd,
        },
        durationMs: Date.now() - startedAt,
        debugEvents,
        debugPayload,
    };
}

function formatFailureMessage(message: string): string {
    const lines = [`deep-review failed: ${message}`];

    if (/context_length_exceeded|exceeds the context window/i.test(message)) {
        lines.push(
            "",
            "Context window hint: rerun without a manual `--budget`, or use a lower `--budget` for the selected model.",
        );
    }

    lines.push("", "Use /deep-review --help for options.");
    return lines.join("\n");
}

function summarizeProvidedContextPackMessage(packPath: string): string {
    return [
        "## Deep review · context pack stage",
        "",
        "- Duration: 0ms (skipped)",
        `- Pack path: \`${packPath}\``,
        "",
        "Using provided pack via `--context-pack`; skipped context-pack generation.",
    ].join("\n");
}

const DEFAULT_CONTEXT_PACK_BUDGET = 272000;
const CONTEXT_PACK_INPUT_FRACTION = 0.75;
const CONTEXT_PACK_MIN_BUDGET = 4096;
const CONTEXT_PACK_OVERHEAD_RESERVE = 12000;
const CONTEXT_PACK_CONTEXT_WINDOW_FLOORS: Partial<Record<string, number>> = {
    "gpt-5.4": 1050000,
};

function estimateQueryReserveTokens(query: string): number {
    const queryChars = query.trim().length;
    const roughTokens = Math.ceil(queryChars / 3);
    return Math.max(2048, roughTokens);
}

function estimateHardInputBudget(model: BudgetModelMetadata): number {
    const safeContextWindow = Math.max(CONTEXT_PACK_MIN_BUDGET, Math.floor(model.contextWindow));
    const safeMaxTokens = Math.max(0, Math.floor(model.maxTokens));
    return Math.max(CONTEXT_PACK_MIN_BUDGET, safeContextWindow - safeMaxTokens);
}

function estimateRatioInputBudget(model: BudgetModelMetadata): number {
    const safeContextWindow = Math.max(CONTEXT_PACK_MIN_BUDGET, Math.floor(model.contextWindow));
    return Math.max(CONTEXT_PACK_MIN_BUDGET, Math.floor(safeContextWindow * CONTEXT_PACK_INPUT_FRACTION));
}

type ModelBudgetDetails = {
    effectiveModel: BudgetModelMetadata;
    modelHardInputBudget: number;
    modelRatioInputBudget: number;
};

function normalizeBudgetModelMetadata(model: BudgetModelMetadata): BudgetModelMetadata {
    if (model.provider !== "openai" && model.provider !== "openai-codex") {
        return model;
    }

    const contextWindowFloor = CONTEXT_PACK_CONTEXT_WINDOW_FLOORS[model.id];
    if (contextWindowFloor === undefined || model.contextWindow >= contextWindowFloor) {
        return model;
    }

    return {
        ...model,
        contextWindow: contextWindowFloor,
    };
}

function getModelBudgetDetails(model: BudgetModelMetadata): ModelBudgetDetails {
    const effectiveModel = normalizeBudgetModelMetadata(model);
    return {
        effectiveModel,
        modelHardInputBudget: estimateHardInputBudget(effectiveModel),
        modelRatioInputBudget: estimateRatioInputBudget(effectiveModel),
    };
}

function toBudgetPlanModelFields(
    details: ModelBudgetDetails,
): Pick<
    ContextPackBudgetPlan,
    | "inputFraction"
    | "modelContextWindow"
    | "modelHardInputBudget"
    | "modelId"
    | "modelMaxTokens"
    | "modelProvider"
    | "modelRatioInputBudget"
> {
    return {
        inputFraction: CONTEXT_PACK_INPUT_FRACTION,
        modelContextWindow: details.effectiveModel.contextWindow,
        modelHardInputBudget: details.modelHardInputBudget,
        modelMaxTokens: details.effectiveModel.maxTokens,
        modelId: details.effectiveModel.id,
        modelProvider: details.effectiveModel.provider,
        modelRatioInputBudget: details.modelRatioInputBudget,
    };
}

function resolveDeepReviewModel(
    modelRegistry: ExtensionCommandContext["modelRegistry"],
    provider: DeepReviewProvider,
    modelId: string,
): BudgetModelMetadata | undefined {
    const fromRegistry = modelRegistry.find(provider, modelId) as BudgetModelMetadata | undefined;

    if (fromRegistry) {
        return normalizeBudgetModelMetadata(fromRegistry);
    }

    const fallback = getModel(provider, modelId as never) as BudgetModelMetadata | undefined;

    return fallback ? normalizeBudgetModelMetadata(fallback) : undefined;
}

export function buildContextPackBudgetPlan(
    options: Pick<DeepReviewOptions, "contextPackBudget" | "model" | "query">,
    model?: BudgetModelMetadata,
): ContextPackBudgetPlan {
    const queryReserveTokens = estimateQueryReserveTokens(options.query);
    const overheadReserveTokens = CONTEXT_PACK_OVERHEAD_RESERVE;

    if (options.contextPackBudget !== undefined) {
        if (model) {
            const details = getModelBudgetDetails(model);
            const cappedRequestedBudget = Math.min(options.contextPackBudget, details.modelHardInputBudget);

            return {
                source: "manual",
                requestedBudget: options.contextPackBudget,
                finalBudget: Math.max(
                    CONTEXT_PACK_MIN_BUDGET,
                    cappedRequestedBudget - overheadReserveTokens - queryReserveTokens,
                ),
                overheadReserveTokens,
                queryReserveTokens,
                modelCappedRequestedBudget:
                    cappedRequestedBudget < options.contextPackBudget ? cappedRequestedBudget : undefined,
                ...toBudgetPlanModelFields(details),
            };
        }

        return {
            source: "manual",
            requestedBudget: options.contextPackBudget,
            finalBudget: Math.max(
                CONTEXT_PACK_MIN_BUDGET,
                options.contextPackBudget - overheadReserveTokens - queryReserveTokens,
            ),
            overheadReserveTokens,
            queryReserveTokens,
        };
    }

    if (model) {
        const details = getModelBudgetDetails(model);
        const requestedBudget = Math.min(details.modelHardInputBudget, details.modelRatioInputBudget);

        return {
            source: "model-auto",
            requestedBudget,
            finalBudget: Math.max(
                CONTEXT_PACK_MIN_BUDGET,
                requestedBudget - overheadReserveTokens - queryReserveTokens,
            ),
            overheadReserveTokens,
            queryReserveTokens,
            ...toBudgetPlanModelFields(details),
        };
    }

    return {
        source: "default",
        requestedBudget: DEFAULT_CONTEXT_PACK_BUDGET,
        finalBudget: Math.max(
            CONTEXT_PACK_MIN_BUDGET,
            DEFAULT_CONTEXT_PACK_BUDGET - overheadReserveTokens - queryReserveTokens,
        ),
        overheadReserveTokens,
        queryReserveTokens,
    };
}

function formatBudgetSource(plan: ContextPackBudgetPlan): string {
    switch (plan.source) {
        case "manual":
            return "manual `--budget` override";
        case "model-auto":
            return `auto from ${plan.modelProvider}/${plan.modelId}`;
        default:
            return `fallback default (${DEFAULT_CONTEXT_PACK_BUDGET.toLocaleString()} tokens)`;
    }
}

function formatContextPackBudgetLines(plan: ContextPackBudgetPlan): string[] {
    const lines = [`- Budget source: ${formatBudgetSource(plan)}`];

    if (plan.modelContextWindow !== undefined) {
        lines.push(`- Model context window: ${plan.modelContextWindow.toLocaleString()} tokens`);
    }

    if (plan.modelMaxTokens !== undefined) {
        lines.push(`- Model max output: ${plan.modelMaxTokens.toLocaleString()} tokens`);
    }

    if (plan.modelHardInputBudget !== undefined) {
        lines.push(`- Hard input limit (context - max output): ${plan.modelHardInputBudget.toLocaleString()} tokens`);
    }

    if (plan.modelRatioInputBudget !== undefined && plan.inputFraction !== undefined) {
        lines.push(
            `- Ratio input cap (${Math.round(plan.inputFraction * 100)}%): ${plan.modelRatioInputBudget.toLocaleString()} tokens`,
        );
    }

    lines.push(`- Requested pack budget: ${plan.requestedBudget.toLocaleString()} tokens`);

    if (plan.modelCappedRequestedBudget !== undefined) {
        lines.push(`- Model-capped request budget: ${plan.modelCappedRequestedBudget.toLocaleString()} tokens`);
    }

    lines.push(`- Overhead reserve: ${plan.overheadReserveTokens.toLocaleString()} tokens`);
    lines.push(`- Query reserve: ${plan.queryReserveTokens.toLocaleString()} tokens`);
    lines.push(`- Effective pack budget: ${plan.finalBudget.toLocaleString()} tokens`);

    return lines;
}

function toContextPackOptions(options: DeepReviewOptions, budgetPlan: ContextPackBudgetPlan): ContextPackOptions {
    return {
        projectDir: options.projectDir,
        baseRef: options.baseRef,
        budget: budgetPlan.finalBudget,
        outputName: "pr-context.txt",
        tmpOutput: true,
        includeDependents: true,
        includeDocs: false,
        includeTests: true,
        includeLockfiles: false,
        includeEnv: false,
        includeSecrets: false,
        diffContext: 3,
        includePrDescription: true,
        prRef: undefined,
        noClipboard: true,
        failOverBudget: false,
        debug: options.debug,
    };
}

function summarizeGeneratedContextPackMessage(
    report: ContextPackReportV1,
    packPath: string,
    durationMs: number,
    budgetPlan: ContextPackBudgetPlan,
): string {
    const lines: string[] = [
        "## Deep review · context pack stage",
        "",
        `- Duration: ${formatDuration(durationMs)}`,
        `- Pack path: \`${packPath}\``,
        `- Budget: ${report.budget.toLocaleString()} tokens`,
        `- Baseline tokens: ${report.tokens.baseline.toLocaleString()}`,
        `- Final tokens: ${report.tokens.final.toLocaleString()}`,
        `- Remaining: ${report.tokens.remaining.toLocaleString()}`,
        "",
        "## Budgeting",
        "",
        ...formatContextPackBudgetLines(budgetPlan),
        "",
        "## Context stats",
        "",
        `- Changed files: ${report.counts.changed.toLocaleString()}`,
        `- Related candidates: ${report.counts.relatedCandidates.toLocaleString()}`,
        `- Related included: ${report.counts.relatedIncluded.toLocaleString()}`,
        `- Related omitted: ${report.counts.relatedOmitted.toLocaleString()}`,
        `- Scribe targets: ${report.counts.scribeTargets.toLocaleString()}`,
        `- Scribe failures: ${report.counts.scribeFailedTargets.toLocaleString()}`,
        `- Scribe limit signals: ${report.counts.scribeLimitSignals.toLocaleString()}`,
    ];

    if (report.paths.reportPath) {
        lines.push("", `- Report JSON: \`${report.paths.reportPath}\``);
    }

    if (report.warnings.length > 0) {
        const maxWarnings = 12;
        const shownWarnings = report.warnings.slice(0, maxWarnings);

        lines.push("", "## Warnings", "");
        for (const warning of shownWarnings) {
            lines.push(`- ${warning}`);
        }

        if (report.warnings.length > shownWarnings.length) {
            lines.push(`- ...and ${report.warnings.length - shownWarnings.length} more warnings`);
        }
    }

    if (report.status !== "ok" && report.error) {
        lines.push("", "## Error", "", `- ${report.error.message}`);
    }

    return lines.join("\n");
}

export function normalizeSectionLikeBoldMarkdown(markdown: string): string {
    if (!markdown.trim()) {
        return markdown;
    }

    const inputLines = markdown.replace(/\r\n/g, "\n").split("\n");
    const out: string[] = [];
    let inFence = false;

    const pushHeading = (headingText: string) => {
        const heading = headingText.trim().replace(/[:：]\s*$/, "");
        if (!heading) {
            return;
        }

        if (out.length > 0 && out[out.length - 1] !== "") {
            out.push("");
        }

        out.push(`### ${heading}`);
        out.push("");
    };

    for (const line of inputLines) {
        if (/^[ \t]*```/.test(line)) {
            inFence = !inFence;
            out.push(line);
            continue;
        }

        if (inFence) {
            out.push(line);
            continue;
        }

        const standaloneBold = line.match(/^[ \t]*\*\*([^*\n]{2,100})\*\*[ \t]*$/);
        if (standaloneBold) {
            pushHeading(standaloneBold[1]);
            continue;
        }

        const boldLabelWithBody = line.match(/^[ \t]*\*\*([^*\n:]{2,80}):\*\*[ \t]*(.+)$/);
        if (boldLabelWithBody) {
            pushHeading(boldLabelWithBody[1]);
            out.push(boldLabelWithBody[2].trim());
            continue;
        }

        out.push(line);
    }

    const collapsed: string[] = [];
    for (const line of out) {
        if (line === "" && collapsed[collapsed.length - 1] === "") {
            continue;
        }
        collapsed.push(line);
    }

    return collapsed.join("\n").trim();
}

function summarizeFinalMessage(
    options: DeepReviewOptions,
    packPath: string,
    packDurationMs: number,
    responses: ResponsesResult,
    totalDurationMs: number,
    budgetPlan?: ContextPackBudgetPlan,
    debugDir?: string,
    artifacts?: OutputArtifacts,
): string {
    const costLine =
        responses.usage.estimatedCostUsd !== undefined
            ? `$${responses.usage.estimatedCostUsd.toFixed(6)} (estimated)`
            : "n/a (model price metadata unavailable)";
    const normalizedAnswer = normalizeSectionLikeBoldMarkdown(responses.answer || "");

    const lines = [
        `# Deep review (${responses.request.provider}/${options.model})`,
        "",
        `- Query: ${options.query}`,
        `- Provider: ${responses.request.provider}`,
        `- Endpoint: ${responses.request.endpoint}`,
        `- Auth source: ${responses.request.tokenSource}`,
        `- Context pack: \`${packPath}\``,
        options.contextPackPath ? "- Context pack source: provided via `--context-pack`" : undefined,
        options.contextPackBudget !== undefined
            ? `- Context pack budget override: ${options.contextPackBudget.toLocaleString()} tokens`
            : undefined,
        `- Context pack time: ${formatDuration(packDurationMs)}`,
        `- Responses time: ${formatDuration(responses.durationMs)}`,
        `- Total time: ${formatDuration(totalDurationMs)}`,
        responses.responseId ? `- Response ID: \`${responses.responseId}\`` : undefined,
        budgetPlan ? "" : undefined,
        budgetPlan ? "## Context budget" : undefined,
        budgetPlan ? "" : undefined,
        ...(budgetPlan ? formatContextPackBudgetLines(budgetPlan) : []),
        "",
        "## Usage",
        "",
        `- Input tokens: ${responses.usage.inputTokens.toLocaleString()}`,
        `- Output tokens: ${responses.usage.outputTokens.toLocaleString()}`,
        `- Cached tokens: ${responses.usage.cachedTokens.toLocaleString()}`,
        `- Total tokens: ${responses.usage.totalTokens.toLocaleString()}`,
        `- Cost: ${costLine}`,
        "",
        "## Final response",
        "",
        normalizedAnswer || "(no output text returned)",
        debugDir ? "" : undefined,
        debugDir ? `Debug artifacts: \`${debugDir}\`` : undefined,
    ].filter((line): line is string => line !== undefined);

    if (artifacts) {
        lines.push(
            "",
            "## Handoff",
            "",
            `- Output directory: \`${artifacts.directory}\``,
            `- Answer file: \`${artifacts.answerPath}\``,
            `- Thinking file: \`${artifacts.thinkingPath}\``,
            `- Report file: \`${artifacts.reportPath}\``,
            `- Metadata file: \`${artifacts.metadataPath}\``,
            artifacts.clipboard.copied
                ? `- Clipboard: copied answer via ${artifacts.clipboard.method ?? "clipboard tool"}`
                : `- Clipboard: not copied (${artifacts.clipboard.error ?? "no clipboard backend"})`,
        );
    }

    return lines.join("\n");
}

export default function deepReviewExtension(pi: ExtensionAPI): void {
    let activeRun: ActiveRun | null = null;

    const markdownTypes = ["deep-review-help", "deep-review-context-pack", "deep-review-result", "deep-review-error"];

    for (const customType of markdownTypes) {
        pi.registerMessageRenderer(customType, (message) => {
            const content =
                typeof message.content === "string"
                    ? message.content
                    : message.content
                          .map((block) => {
                              if (block.type === "text") {
                                  return block.text;
                              }
                              return "[non-text content omitted]";
                          })
                          .join("\n");

            return new Markdown(content, 0, 0, MARKDOWN_THEME);
        });
    }

    pi.registerCommand("deep-review-stop", {
        description: "Stop an in-flight /deep-review run",
        handler: async (_args, ctx) => {
            if (!activeRun) {
                if (ctx.hasUI) {
                    ctx.ui.notify("No deep-review run in progress", "info");
                }
                return;
            }

            activeRun.controller.abort();
        },
    });

    pi.registerCommand("deep-review", {
        description: "Build context pack, then stream Responses in real time",
        handler: async (rawArgs, ctx) => {
            if (activeRun) {
                if (ctx.hasUI) {
                    ctx.ui.notify("deep-review already running. Use /deep-review-stop first.", "warning");
                }
                return;
            }

            const parsed = parseOptions(rawArgs, ctx.cwd);
            if (!parsed.ok && "help" in parsed) {
                pi.sendMessage({ customType: "deep-review-help", content: HELP_TEXT, display: true });
                return;
            }

            if (!parsed.ok) {
                const content = `deep-review argument error: ${parsed.message}\n\nUse /deep-review --help for usage.`;
                pi.sendMessage({ customType: "deep-review-error", content, display: true });
                if (ctx.hasUI) {
                    ctx.ui.notify(parsed.message, "error");
                }
                return;
            }

            const options = parsed.options;

            const active: ActiveRun = {
                controller: new AbortController(),
            };
            activeRun = active;

            void (async () => {
                const startedAt = Date.now();

                const live: LiveState = {
                    startedAt,
                    phase: "context-pack",
                    thinking: "",
                    answer: "",
                    responsesEventCount: 0,
                    lastResponsesEventType: undefined,
                    lastRenderAt: 0,
                };

                if (ctx.hasUI) {
                    ctx.ui.setStatus("deep-review", ctx.ui.theme.fg("accent", "deep-review: context pack"));
                    ctx.ui.setWorkingMessage("deep-review running...");
                    renderLiveWidget(ctx, live, true);
                }

                const renderTicker = ctx.hasUI
                    ? setInterval(() => {
                          renderLiveWidget(ctx, live, true);
                      }, WIDGET_TICK_MS)
                    : undefined;

                let debugDir: string | undefined;

                try {
                    let packPath: string | undefined;
                    let packDurationMs = 0;
                    let contextPackBudgetPlan: ContextPackBudgetPlan | undefined;
                    let contextPackDebugOutput = "";
                    let generatedPackReport: ContextPackReportV1 | undefined;

                    if (options.contextPackPath) {
                        packPath = options.contextPackPath;

                        if (!(await pathExists(packPath))) {
                            throw new Error(`Context pack file not found: ${packPath}`);
                        }

                        contextPackDebugOutput = `Using existing context pack from --context-pack: ${packPath}`;

                        pi.sendMessage({
                            customType: "deep-review-context-pack",
                            content: summarizeProvidedContextPackMessage(packPath),
                            display: true,
                        });
                    } else {
                        const resolvedModel = resolveDeepReviewModel(
                            ctx.modelRegistry,
                            options.provider,
                            options.model,
                        );
                        contextPackBudgetPlan = buildContextPackBudgetPlan(options, resolvedModel);

                        const packStartedAt = Date.now();
                        const contextPackResult = await buildContextPack(
                            toContextPackOptions(options, contextPackBudgetPlan),
                        );
                        packDurationMs = Date.now() - packStartedAt;
                        generatedPackReport = contextPackResult.report;
                        contextPackDebugOutput = `${JSON.stringify(
                            {
                                budgetPlan: contextPackBudgetPlan,
                                report: contextPackResult.report,
                            },
                            null,
                            4,
                        )}\n`;

                        if (!contextPackResult.ok) {
                            const contentLines = ["deep-review context-pack failed."];

                            if (contextPackResult.report.error) {
                                contentLines.push("", `- ${contextPackResult.report.error.message}`);
                            }

                            if (contextPackResult.report.paths.reportPath) {
                                contentLines.push("", `- Report: \`${contextPackResult.report.paths.reportPath}\``);
                            }

                            if (contextPackBudgetPlan) {
                                contentLines.push(
                                    "",
                                    "### Budgeting",
                                    "",
                                    ...formatContextPackBudgetLines(contextPackBudgetPlan),
                                );
                            }

                            if (contextPackResult.report.warnings.length > 0) {
                                const maxWarnings = 12;
                                const shownWarnings = contextPackResult.report.warnings.slice(0, maxWarnings);

                                contentLines.push("", "### Warnings", "");
                                for (const warning of shownWarnings) {
                                    contentLines.push(`- ${warning}`);
                                }

                                if (contextPackResult.report.warnings.length > shownWarnings.length) {
                                    contentLines.push(
                                        `- ...and ${contextPackResult.report.warnings.length - shownWarnings.length} more warnings`,
                                    );
                                }
                            }

                            pi.sendMessage({
                                customType: "deep-review-error",
                                content: contentLines.join("\n"),
                                display: true,
                            });
                            return;
                        }

                        packPath = contextPackResult.packPath;

                        if (!(await pathExists(packPath))) {
                            throw new Error(`Context pack file not found after generation: ${packPath}`);
                        }

                        pi.sendMessage({
                            customType: "deep-review-context-pack",
                            content: summarizeGeneratedContextPackMessage(
                                contextPackResult.report,
                                packPath,
                                packDurationMs,
                                contextPackBudgetPlan,
                            ),
                            display: true,
                        });
                    }

                    if (!packPath) {
                        throw new Error("Context pack path was not resolved.");
                    }

                    const contextText = await readFile(packPath, "utf8");

                    live.phase = "responses";
                    live.responsesEventCount = 0;
                    live.lastResponsesEventType = undefined;

                    if (ctx.hasUI) {
                        ctx.ui.setStatus("deep-review", ctx.ui.theme.fg("accent", "deep-review: responses stream"));
                        renderLiveWidget(ctx, live, true);
                    }

                    const responses = await streamResponses(
                        options,
                        contextText,
                        ctx,
                        active.controller.signal,
                        (delta) => {
                            live.thinking += delta;
                            renderLiveWidget(ctx, live);
                        },
                        (delta) => {
                            live.answer += delta;
                            renderLiveWidget(ctx, live);
                        },
                        (eventType) => {
                            live.responsesEventCount += 1;
                            live.lastResponsesEventType = eventType;
                            renderLiveWidget(ctx, live);
                        },
                    );

                    if (options.debug) {
                        debugDir = await mkdtemp(path.join(os.tmpdir(), "deep-review-"));
                        await writeFile(path.join(debugDir, "context-pack-output.txt"), contextPackDebugOutput, "utf8");

                        if (generatedPackReport) {
                            await writeFile(
                                path.join(debugDir, "context-pack-report.json"),
                                `${JSON.stringify(generatedPackReport, null, 4)}\n`,
                                "utf8",
                            );
                        }

                        await writeFile(
                            path.join(debugDir, "responses-events.jsonl"),
                            `${responses.debugEvents.join("\n")}\n`,
                            "utf8",
                        );

                        if (responses.debugPayload) {
                            await writeFile(
                                path.join(debugDir, "responses-request.json"),
                                `${responses.debugPayload}\n`,
                                "utf8",
                            );
                        }
                    }

                    const totalDurationMs = Date.now() - startedAt;
                    const preliminaryContent = summarizeFinalMessage(
                        options,
                        packPath,
                        packDurationMs,
                        responses,
                        totalDurationMs,
                        contextPackBudgetPlan,
                        debugDir,
                    );

                    let artifacts: OutputArtifacts | undefined;

                    try {
                        artifacts = await writeOutputArtifacts(
                            options,
                            packPath,
                            responses,
                            totalDurationMs,
                            preliminaryContent,
                            contextPackBudgetPlan,
                            debugDir,
                        );
                    } catch (artifactError) {
                        const artifactMessage =
                            artifactError instanceof Error ? artifactError.message : String(artifactError);

                        if (ctx.hasUI) {
                            ctx.ui.notify(`Could not write deep-review artifacts: ${artifactMessage}`, "warning");
                        }
                    }

                    const finalContent = summarizeFinalMessage(
                        options,
                        packPath,
                        packDurationMs,
                        responses,
                        totalDurationMs,
                        contextPackBudgetPlan,
                        debugDir,
                        artifacts,
                    );

                    if (artifacts) {
                        await writeFile(artifacts.reportPath, `${finalContent}\n`, "utf8");
                    }

                    pi.sendMessage({ customType: "deep-review-result", content: finalContent, display: true });

                    if (ctx.hasUI) {
                        if (artifacts?.clipboard.copied) {
                            ctx.ui.notify("deep-review complete · answer copied to clipboard", "info");
                        } else {
                            ctx.ui.notify("deep-review complete", "info");
                        }
                    }
                } catch (error) {
                    const stopped = active.controller.signal.aborted;
                    const message = error instanceof Error ? error.message : String(error);

                    if (stopped) {
                        pi.sendMessage({
                            customType: "deep-review-result",
                            content: "deep-review stopped.",
                            display: true,
                        });
                    } else {
                        const content = formatFailureMessage(message);
                        pi.sendMessage({ customType: "deep-review-error", content, display: true });
                        if (ctx.hasUI) {
                            ctx.ui.notify(message, "error");
                        }
                    }
                } finally {
                    if (renderTicker) {
                        clearInterval(renderTicker);
                    }
                    if (ctx.hasUI) {
                        ctx.ui.setStatus("deep-review", undefined);
                        ctx.ui.setWidget("deep-review-live", undefined);
                        ctx.ui.setWorkingMessage();
                    }
                    activeRun = null;
                }
            })();

            if (ctx.hasUI) {
                ctx.ui.notify("deep-review started · use /deep-review-stop to stop", "info");
            }
        },
    });
}
