import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calculateCost, StringEnum, Type, type Usage } from "@earendil-works/pi-ai";
import {
    DEFAULT_MAX_BYTES,
    DEFAULT_MAX_LINES,
    type ExtensionAPI,
    type ExtensionContext,
    formatSize,
    getAgentDir,
    truncateHead,
} from "@earendil-works/pi-coding-agent";
import { searchBrave } from "./brave.js";
import { searchClaude } from "./claude.js";
import { searchCodex } from "./codex.js";
import { fetchExaPage, searchExa } from "./exa.js";
import { fetchPage, type Page, parseHttpUrl } from "./fetch.js";
import { type AntigravitySearch, searchGoogle } from "./google.js";
import {
    FRESHNESS,
    formatSearchResult,
    PROVIDERS,
    type Provider,
    type SearchRequest,
    type SearchResult,
} from "./results.js";

const DEFAULT_PROVIDER: Provider = "exa";
const DEFAULT_RESULTS = 5;

const SEARCH_GUIDELINES = [
    "Use web_search for current information, documentation, releases, and anything that may postdate your training data; cite the URLs you rely on.",
    "web_search defaults to exa, which returns ranked pages with query-relevant excerpts. Use provider brave for exact keyword or phrase lookups, or when exa fails.",
    "Use web_search providers claude, codex, or google only when the user asks for them or wants a second opinion; they return another model's summary, so verify key claims with web_fetch.",
    "Use web_fetch to read a specific URL as markdown. Use the librarian skill for git repositories and the web-browser skill for pages that need clicks, forms, or screenshots.",
];

const searchParameters = Type.Object({
    query: Type.String({ description: "What to search for, in natural language." }),
    provider: Type.Optional(
        StringEnum(PROVIDERS, {
            description:
                "exa (default): ranked pages with relevant excerpts. brave: keyword search with snippets. " +
                "claude, codex, google: another model searches and returns a cited summary.",
        }),
    ),
    numResults: Type.Optional(
        Type.Integer({ description: "Results for exa or brave (1-20). Default 5.", minimum: 1, maximum: 20 }),
    ),
    freshness: Type.Optional(StringEnum(FRESHNESS, { description: "Only use sources published within this period." })),
    domains: Type.Optional(
        Type.Array(Type.String(), { description: "Only use sources from these domains, e.g. ['github.com']." }),
    ),
});

const fetchParameters = Type.Object({
    url: Type.String({ description: "http(s) URL to read." }),
});

function envKey(name: string, provider: Provider): string {
    const key = process.env[name]?.trim();
    if (!key) throw new Error(`Missing ${name} for web_search provider ${provider}. Add it to the Pi environment.`);
    return key;
}

async function piCredential(ctx: ExtensionContext, piProvider: string, provider: Provider): Promise<string> {
    const key = await ctx.modelRegistry.getApiKeyForProvider(piProvider);
    if (!key) throw new Error(`web_search provider ${provider} needs Pi credentials. Run /login ${piProvider}.`);
    return key;
}

async function loadAntigravitySearch(): Promise<AntigravitySearch> {
    const modulePath = join(getAgentDir(), "npm", "node_modules", "pi-antigravity", "src", "search", "index.ts");
    if (!existsSync(modulePath)) {
        throw new Error(`web_search provider google needs the npm:pi-antigravity package (looked for ${modulePath}).`);
    }
    return (await import(modulePath)) as AntigravitySearch;
}

async function runSearch(provider: Provider, request: SearchRequest, ctx: ExtensionContext): Promise<SearchResult> {
    switch (provider) {
        case "exa":
            try {
                return await searchExa(request, envKey("EXA_API_KEY", provider));
            } catch (error) {
                if (request.signal?.aborted) throw error;
                const message = error instanceof Error ? error.message : String(error);
                throw new Error(`${message}\nRetry with provider "brave".`);
            }
        case "brave":
            return searchBrave(request, envKey("BRAVE_API_KEY", provider));
        case "claude":
            return searchClaude(request, await piCredential(ctx, "anthropic", provider));
        case "codex":
            return searchCodex(request, await piCredential(ctx, "openai-codex", provider));
        case "google":
            return searchGoogle(
                request,
                await piCredential(ctx, "antigravity", provider),
                await loadAntigravitySearch(),
            );
    }
}

const USAGE_PROVIDER: Partial<Record<Provider, string>> = { claude: "anthropic", codex: "openai-codex" };

/** Report nested model calls so session token and cost totals include them. */
function nestedUsage(ctx: ExtensionContext, result: SearchResult): Usage | undefined {
    if (result.kind !== "answer" || !result.tokens) return undefined;
    const tokens = result.tokens;
    const usage: Usage = {
        ...tokens,
        totalTokens: tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };
    const piProvider = USAGE_PROVIDER[result.provider];
    const model = piProvider ? ctx.modelRegistry.find(piProvider, result.model) : undefined;
    if (model) usage.cost = calculateCost(model, usage);
    return usage;
}

/** Cap model-facing output at Pi's tool limits; save the full text to a temp file when truncated. */
async function truncateForModel(text: string, label: string): Promise<{ text: string; fullOutputPath?: string }> {
    const truncation = truncateHead(text, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
    if (!truncation.truncated) return { text };

    const fullOutputPath = join(await mkdtemp(join(tmpdir(), `pi-web-${label}-`)), "output.md");
    await writeFile(fullOutputPath, text, "utf8");
    const shown = `${truncation.outputLines} of ${truncation.totalLines} lines, ${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}`;
    return {
        text: `${truncation.content}\n\n[Truncated: showing ${shown}. Full output: ${fullOutputPath}]`,
        fullOutputPath,
    };
}

function formatPage(page: Page, via: string): string {
    const header = [page.title ? `# ${page.title}` : undefined, `URL: ${page.url}`, `Fetched via: ${via}`];
    return [...header.filter(Boolean), "", page.text].join("\n");
}

export default function piWebExtension(pi: ExtensionAPI): void {
    pi.registerTool({
        name: "web_search",
        label: "Web Search",
        description:
            "Search the web. Providers: exa (default, ranked pages with relevant excerpts), brave (keyword search), " +
            "and claude, codex, google (another model searches and returns a cited summary). " +
            `Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}.`,
        promptSnippet: "Search the web (exa by default; brave, claude, codex, google on request)",
        promptGuidelines: SEARCH_GUIDELINES,
        parameters: searchParameters,
        async execute(_toolCallId, params, signal, onUpdate, ctx) {
            const provider = params.provider ?? DEFAULT_PROVIDER;
            const query = params.query.trim();
            if (!query) throw new Error("web_search query cannot be empty.");

            onUpdate?.({ content: [{ type: "text", text: `Searching ${provider}: ${query}` }], details: undefined });
            const result = await runSearch(
                provider,
                {
                    query,
                    numResults: params.numResults ?? DEFAULT_RESULTS,
                    freshness: params.freshness,
                    domains: params.domains?.map((domain) => domain.trim()).filter(Boolean),
                    signal,
                },
                ctx,
            );
            const output = await truncateForModel(formatSearchResult(result), "search");

            return {
                content: [{ type: "text", text: output.text }],
                details: {
                    provider,
                    kind: result.kind,
                    count: result.kind === "results" ? result.hits.length : result.sources.length,
                    costUsd: result.kind === "results" ? result.costUsd : undefined,
                    model: result.kind === "answer" ? result.model : undefined,
                    fullOutputPath: output.fullOutputPath,
                },
                usage: nestedUsage(ctx, result),
            };
        },
    });

    pi.registerTool({
        name: "web_fetch",
        label: "Web Fetch",
        description:
            "Read a web page as markdown (non-HTML text is returned as-is). Fetches the page directly and falls back " +
            `to Exa's page cache when that fails. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}.`,
        promptSnippet: "Read a web page as markdown",
        parameters: fetchParameters,
        async execute(_toolCallId, params, signal) {
            const url = parseHttpUrl(params.url.trim()).toString();

            let page: Page;
            let via = "direct";
            try {
                page = await fetchPage(url, signal);
            } catch (directError) {
                const exaKey = process.env.EXA_API_KEY?.trim();
                if (signal?.aborted || !exaKey) throw directError;
                const reason = directError instanceof Error ? directError.message : String(directError);
                try {
                    page = await fetchExaPage(url, exaKey, signal);
                } catch (exaError) {
                    const exaReason = exaError instanceof Error ? exaError.message : String(exaError);
                    throw new Error(`Direct fetch failed: ${reason}\nExa fallback failed: ${exaReason}`);
                }
                via = `exa (direct fetch failed: ${reason})`;
            }

            const output = await truncateForModel(formatPage(page, via), "fetch");
            return {
                content: [{ type: "text", text: output.text }],
                details: { url: page.url, via, chars: page.text.length, fullOutputPath: output.fullOutputPath },
            };
        },
    });
}
