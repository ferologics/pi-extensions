import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { StringEnum, Type } from "@earendil-works/pi-ai";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead } from "@earendil-works/pi-coding-agent";
import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable";
import { searchBrave } from "../../pi-web/brave.js";
import { searchClaude } from "../../pi-web/claude.js";
import { searchCodex } from "../../pi-web/codex.js";
import { fetchExaPage, searchExa } from "../../pi-web/exa.js";
import { fetchPage, type Page, parseHttpUrl } from "../../pi-web/fetch.js";
import { FRESHNESS, formatSearchResult, type SearchRequest, type SearchResult } from "../../pi-web/results.js";

const run = promisify(execFile);

/** Search providers available to jobs; google needs pi-antigravity's in-process search and is left out. */
const PROVIDERS = ["exa", "brave", "claude", "codex"] as const;
type Provider = (typeof PROVIDERS)[number];

export interface ToolHost {
    /** OAuth/API key Pi stores for a provider (auth.json). */
    piCredential(provider: string): Promise<string | undefined>;
    /** Record an inbox item and show a desktop notification. */
    notify(conversationId: number, item: { title: string; message: string; url?: string }): Promise<void>;
}

/**
 * Env first, then the launchctl cache that fish's Pi secrets bootstrap fills, so a daemon started at login
 * picks keys up once any shell warmed the cache.
 */
export async function secret(name: string): Promise<string | undefined> {
    const fromEnv = process.env[name]?.trim();
    if (fromEnv) return fromEnv;
    if (process.platform !== "darwin") return undefined;
    try {
        const { stdout } = await run("/bin/launchctl", ["getenv", name]);
        return stdout.trim() || undefined;
    } catch {
        return undefined;
    }
}

async function requireSecret(name: string, provider: string): Promise<string> {
    const key = await secret(name);
    if (!key) {
        throw new Error(
            `Missing ${name} for web_search provider ${provider}; open a terminal so the Pi secrets bootstrap warms launchctl.`,
        );
    }
    return key;
}

async function truncateForModel(text: string, label: string): Promise<string> {
    const truncation = truncateHead(text, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
    if (!truncation.truncated) return text;
    const path = join(await mkdtemp(join(tmpdir(), `pi-jobs-${label}-`)), "output.md");
    await writeFile(path, text, "utf8");
    return `${truncation.content}\n\n[Truncated to ${truncation.outputLines} of ${truncation.totalLines} lines. Full output: ${path}]`;
}

function formatPage(page: Page, via: string): string {
    const header = [page.title ? `# ${page.title}` : undefined, `URL: ${page.url}`, `Fetched via: ${via}`];
    return [...header.filter(Boolean), "", page.text].join("\n");
}

async function runSearch(host: ToolHost, provider: Provider, request: SearchRequest): Promise<SearchResult> {
    const credential = async (piProvider: string) => {
        const key = await host.piCredential(piProvider);
        if (!key) throw new Error(`web_search provider ${provider} needs a Pi login for ${piProvider}.`);
        return key;
    };
    switch (provider) {
        case "exa":
            return searchExa(request, await requireSecret("EXA_API_KEY", provider));
        case "brave":
            return searchBrave(request, await requireSecret("BRAVE_API_KEY", provider));
        case "claude":
            return searchClaude(request, await credential("anthropic"));
        case "codex":
            return searchCodex(request, await credential("openai-codex"));
    }
}

export function createJobTools(host: ToolHost): Extension {
    const webSearch = defineTool({
        name: "web_search",
        description:
            "Search the web. Providers: exa (default, ranked pages with relevant excerpts), brave (keyword search), " +
            "claude and codex (another model searches and returns a cited summary).",
        parameters: Type.Object({
            query: Type.String({ description: "What to search for, in natural language." }),
            provider: Type.Optional(StringEnum(PROVIDERS)),
            numResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
            freshness: Type.Optional(StringEnum(FRESHNESS)),
            domains: Type.Optional(Type.Array(Type.String())),
        }),
        replay: "safe",
        execute: async (args, api) => {
            const provider = args.provider ?? "exa";
            api.output(`searching ${provider}: ${args.query}\n`);
            const result = await runSearch(host, provider, {
                query: args.query.trim(),
                numResults: args.numResults ?? 5,
                freshness: args.freshness,
                domains: args.domains,
            });
            return {
                output: [{ type: "text", text: await truncateForModel(formatSearchResult(result), "search") }],
            };
        },
    });

    const webFetch = defineTool({
        name: "web_fetch",
        description:
            "Read a web page as markdown (non-HTML text is returned as-is). Fetches the page directly and falls back " +
            "to Exa's page cache when that fails.",
        parameters: Type.Object({ url: Type.String({ description: "http(s) URL to read." }) }),
        replay: "safe",
        execute: async (args, api) => {
            const url = parseHttpUrl(args.url.trim()).toString();
            api.output(`fetching ${url}\n`);
            let page: Page;
            let via = "direct";
            try {
                page = await fetchPage(url);
            } catch (directError) {
                const exaKey = await secret("EXA_API_KEY");
                if (!exaKey) throw directError;
                const reason = directError instanceof Error ? directError.message : String(directError);
                page = await fetchExaPage(url, exaKey);
                via = `exa (direct fetch failed: ${reason})`;
            }
            return { output: [{ type: "text", text: await truncateForModel(formatPage(page, via), "fetch") }] };
        },
    });

    // Not replay-safe: a crash mid-call reports the call as interrupted instead of notifying twice.
    const notify = defineTool({
        name: "notify",
        description:
            "Notify the user: shows a desktop notification and adds the item to the pi-jobs inbox. " +
            "Call it only when the job's instructions say the finding needs the user's attention.",
        parameters: Type.Object({
            title: Type.String({ description: "Short headline." }),
            message: Type.String({ description: "One or two sentences: what changed and what to do." }),
            url: Type.Optional(Type.String({ description: "Link to the source, if any." })),
        }),
        execute: async (args, api) => {
            await host.notify(api.conversationId, args);
            return { output: [{ type: "text", text: "Notified." }] };
        },
    });

    return defineExtension({ name: "pi-jobs", tools: [webSearch, webFetch, notify] });
}
