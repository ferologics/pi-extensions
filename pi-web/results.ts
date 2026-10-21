export const PROVIDERS = ["exa", "brave", "claude", "codex", "google"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const FRESHNESS = ["day", "week", "month", "year"] as const;
export type Freshness = (typeof FRESHNESS)[number];

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface SearchRequest {
    query: string;
    numResults: number;
    freshness?: Freshness;
    domains?: string[];
    signal?: AbortSignal;
}

export interface SearchHit {
    title: string;
    url: string;
    published?: string;
    text: string;
}

export interface Source {
    title: string;
    url: string;
}

/** Token counts reported by a nested model call; index.ts prices them with the Pi model catalog. */
export interface ModelTokens {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
}

export type SearchResult =
    | { kind: "results"; provider: Provider; hits: SearchHit[]; costUsd?: number }
    | {
          kind: "answer";
          provider: Provider;
          model: string;
          answer: string;
          sources: Source[];
          queries: string[];
          tokens?: ModelTokens;
      };

const FRESHNESS_DAYS: Record<Freshness, number> = { day: 1, week: 7, month: 31, year: 365 };

export function freshnessStart(freshness: Freshness, now = new Date()): Date {
    return new Date(now.getTime() - FRESHNESS_DAYS[freshness] * 24 * 60 * 60 * 1000);
}

/** Prompt used by the answer providers (claude, codex, google), which search with their own model. */
export function answerPrompt(request: SearchRequest): string {
    const lines = [`Search the web and answer: ${request.query}`];
    if (request.domains?.length) lines.push(`Only use sources from: ${request.domains.join(", ")}.`);
    if (request.freshness) lines.push(`Only use sources published within the past ${request.freshness}.`);
    lines.push(
        "Answer concisely with the key facts, and cite the full source URL for each claim.",
        "Say so when sources disagree or when you could not find something.",
    );
    return lines.join("\n");
}

export function dedupeSources(sources: Source[]): Source[] {
    const seen = new Set<string>();
    return sources.filter((source) => {
        if (!source.url || seen.has(source.url)) return false;
        seen.add(source.url);
        return true;
    });
}

export function formatSearchResult(result: SearchResult): string {
    if (result.kind === "results") {
        if (result.hits.length === 0) return `${result.provider}: no results.`;
        const header = `${result.provider}: ${result.hits.length} result${result.hits.length === 1 ? "" : "s"}`;
        const hits = result.hits.map((hit, index) => {
            const lines = [`[${index + 1}] ${hit.title || hit.url}`, hit.url];
            if (hit.published) lines.push(`Published: ${hit.published}`);
            if (hit.text) lines.push("", hit.text);
            return lines.join("\n");
        });
        return [header, ...hits].join("\n\n");
    }

    const sections = [
        `${result.provider} (${result.model}) answer. This is another model's summary; verify key claims with web_fetch.`,
        result.answer,
    ];
    if (result.sources.length > 0) {
        sections.push(
            `Sources:\n${result.sources.map((source) => `- ${source.title || source.url}: ${source.url}`).join("\n")}`,
        );
    }
    if (result.queries.length > 0) {
        sections.push(`Searches: ${result.queries.map((query) => JSON.stringify(query)).join(", ")}`);
    }
    return sections.join("\n\n");
}

/** Node has AbortSignal.any; the bundled typings do not declare it. */
export function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
    const timeout = AbortSignal.timeout(ms);
    if (!signal) return timeout;
    return (AbortSignal as unknown as { any(signals: AbortSignal[]): AbortSignal }).any([signal, timeout]);
}

export async function requestJson(
    fetchImpl: FetchLike,
    label: string,
    url: string,
    init: RequestInit,
): Promise<unknown> {
    const response = await fetchImpl(url, init);
    const body = await response.text();
    if (!response.ok) {
        throw new Error(`${label} request failed (HTTP ${response.status}): ${body.slice(0, 500)}`);
    }
    try {
        return JSON.parse(body);
    } catch {
        throw new Error(`${label} returned invalid JSON: ${body.slice(0, 200)}`);
    }
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

export function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

export function asString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

export function asNumber(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
