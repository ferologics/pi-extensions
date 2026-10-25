/**
 * pi-web's tools for Pi Durable harnesses: `web_search` and `web_fetch` as durable tool registrations, built on the
 * same provider and page modules as the Pi extension. Import from `@ferologics/pi-web/durable`.
 *
 * Only types come from `@earendil-works/pi-durable`; its `defineTool`/`defineExtension` are identity helpers, so the
 * registrations here are plain objects and pi-web has no runtime dependency on it.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringEnum, Type } from "@earendil-works/pi-ai";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead } from "@earendil-works/pi-coding-agent";
import type { Extension, ToolRegistration } from "@earendil-works/pi-durable";
import { searchBrave } from "./brave.js";
import { searchClaude } from "./claude.js";
import { searchCodex } from "./codex.js";
import { fetchExaPage, searchExa } from "./exa.js";
import { fetchPage, type Page, parseHttpUrl } from "./fetch.js";
import { FRESHNESS, formatSearchResult, type SearchRequest, type SearchResult } from "./results.js";

/** Search providers available outside Pi; google needs pi-antigravity loaded in Pi's process and is left out. */
export const DURABLE_PROVIDERS = ["exa", "brave", "claude", "codex"] as const;
type Provider = (typeof DURABLE_PROVIDERS)[number];

export interface WebToolsOptions {
    /** An API key from the host's environment, or undefined when it is not set. */
    secret(name: "EXA_API_KEY" | "BRAVE_API_KEY"): Promise<string | undefined>;
    /** The credential Pi stores for a login (for example its OAuth access token), or undefined without one. */
    credential(provider: "anthropic" | "openai-codex"): Promise<string | undefined>;
}

const searchParameters = Type.Object({
    query: Type.String({ description: "What to search for, in natural language." }),
    provider: Type.Optional(
        StringEnum(DURABLE_PROVIDERS, {
            description:
                "exa (default): ranked pages with relevant excerpts. brave: keyword search with snippets. " +
                "claude, codex: another model searches and returns a cited summary.",
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

/** Cap model-facing output at Pi's tool limits; save the full text to a temp file when truncated. */
async function truncateForModel(text: string, label: string): Promise<string> {
    const truncation = truncateHead(text, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
    if (!truncation.truncated) return text;
    const path = join(await mkdtemp(join(tmpdir(), `pi-web-${label}-`)), "output.md");
    await writeFile(path, text, "utf8");
    return `${truncation.content}\n\n[Truncated to ${truncation.outputLines} of ${truncation.totalLines} lines. Full output: ${path}]`;
}

function formatPage(page: Page, via: string): string {
    const header = [page.title ? `# ${page.title}` : undefined, `URL: ${page.url}`, `Fetched via: ${via}`];
    return [...header.filter(Boolean), "", page.text].join("\n");
}

async function runSearch(options: WebToolsOptions, provider: Provider, request: SearchRequest): Promise<SearchResult> {
    const secret = async (name: "EXA_API_KEY" | "BRAVE_API_KEY") => {
        const key = await options.secret(name);
        if (!key) throw new Error(`Missing ${name} for web_search provider ${provider}.`);
        return key;
    };
    const credential = async (piProvider: "anthropic" | "openai-codex") => {
        const key = await options.credential(piProvider);
        if (!key) throw new Error(`web_search provider ${provider} needs a Pi login for ${piProvider}.`);
        return key;
    };
    switch (provider) {
        case "exa":
            try {
                return await searchExa(request, await secret("EXA_API_KEY"));
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                throw new Error(`${message}\nRetry with provider "brave".`);
            }
        case "brave":
            return searchBrave(request, await secret("BRAVE_API_KEY"));
        case "claude":
            return searchClaude(request, await credential("anthropic"));
        case "codex":
            return searchCodex(request, await credential("openai-codex"));
    }
}

/** `web_search` and `web_fetch` as one durable extension named `pi-web`; install it in a harness registry. */
export function createWebTools(options: WebToolsOptions): Extension {
    const webSearch: ToolRegistration<typeof searchParameters> = {
        name: "web_search",
        description:
            "Search the web. Providers: exa (default, ranked pages with relevant excerpts), brave (keyword search), " +
            "claude and codex (another model searches and returns a cited summary).",
        parameters: searchParameters,
        replay: "safe",
        execute: async (args, api) => {
            const provider = args.provider ?? "exa";
            api.output(`searching ${provider}: ${args.query}\n`);
            const result = await runSearch(options, provider, {
                query: args.query.trim(),
                numResults: args.numResults ?? 5,
                freshness: args.freshness,
                domains: args.domains?.map((domain) => domain.trim()).filter(Boolean),
            });
            return { output: [{ type: "text", text: await truncateForModel(formatSearchResult(result), "search") }] };
        },
    };

    const webFetch: ToolRegistration<typeof fetchParameters> = {
        name: "web_fetch",
        description:
            "Read a web page as markdown (non-HTML text is returned as-is). Fetches the page directly and falls back " +
            "to Exa's page cache when that fails.",
        parameters: fetchParameters,
        replay: "safe",
        execute: async (args, api) => {
            const url = parseHttpUrl(args.url.trim()).toString();
            api.output(`fetching ${url}\n`);
            let page: Page;
            let via = "direct";
            try {
                page = await fetchPage(url);
            } catch (directError) {
                const exaKey = await options.secret("EXA_API_KEY");
                if (!exaKey) throw directError;
                const reason = directError instanceof Error ? directError.message : String(directError);
                try {
                    page = await fetchExaPage(url, exaKey);
                } catch (exaError) {
                    const exaReason = exaError instanceof Error ? exaError.message : String(exaError);
                    throw new Error(`Direct fetch failed: ${reason}\nExa fallback failed: ${exaReason}`);
                }
                via = `exa (direct fetch failed: ${reason})`;
            }
            return { output: [{ type: "text", text: await truncateForModel(formatPage(page, via), "fetch") }] };
        },
    };

    return { name: "pi-web", tools: [webSearch, webFetch] };
}
