import { type FetchLike, type SearchRequest, type SearchResult, withTimeout } from "./results.js";

/** The search entry point exported by pi-antigravity's `src/search` module. */
export interface AntigravitySearch {
    executeAntigravitySearch(options: {
        apiKey?: string;
        query: string;
        instruction?: string;
        signal?: AbortSignal;
    }): Promise<string>;
}

// pi-antigravity picks the Gemini model and falls back between versions itself.
const ANTIGRAVITY_MODEL_LABEL = "Gemini via Antigravity";
const REDIRECT_PATTERN = /https:\/\/vertexaisearch\.cloud\.google\.com\/grounding-api-redirect\/[A-Za-z0-9_\-=]+/g;
const REDIRECT_TIMEOUT_MS = 5_000;

/** Grounding citations are opaque Google redirect links; swap each for the page it redirects to. */
export async function resolveGroundingRedirects(
    markdown: string,
    fetchImpl: FetchLike = fetch,
    signal?: AbortSignal,
): Promise<string> {
    const redirects = [...new Set(markdown.match(REDIRECT_PATTERN) ?? [])];
    const resolved = new Map<string, string>();

    await Promise.all(
        redirects.map(async (redirect) => {
            try {
                const response = await fetchImpl(redirect, {
                    method: "GET",
                    redirect: "manual",
                    signal: withTimeout(signal, REDIRECT_TIMEOUT_MS),
                });
                const location = response.headers.get("location");
                if (location) resolved.set(redirect, location);
            } catch {
                // Keep the redirect link when it cannot be resolved.
            }
        }),
    );

    return markdown.replace(REDIRECT_PATTERN, (redirect) => resolved.get(redirect) ?? redirect);
}

export async function searchGoogle(
    request: SearchRequest,
    apiKey: string,
    antigravity: AntigravitySearch,
    fetchImpl: FetchLike = fetch,
): Promise<SearchResult> {
    const filters: string[] = [];
    if (request.domains?.length) filters.push(`Only use sources from: ${request.domains.join(", ")}.`);
    if (request.freshness) filters.push(`Only use sources published within the past ${request.freshness}.`);

    const markdown = await antigravity.executeAntigravitySearch({
        apiKey,
        query: request.query,
        instruction: filters.length ? filters.join(" ") : undefined,
        signal: request.signal,
    });

    return {
        kind: "answer",
        provider: "google",
        model: ANTIGRAVITY_MODEL_LABEL,
        // pi-antigravity formats its own Sources and search-query sections into the markdown.
        answer: await resolveGroundingRedirects(markdown, fetchImpl, request.signal),
        sources: [],
        queries: [],
    };
}
