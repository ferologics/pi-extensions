import {
    asArray,
    asRecord,
    asString,
    type FetchLike,
    type Freshness,
    requestJson,
    type SearchRequest,
    type SearchResult,
} from "./results.js";

const BRAVE_WEB_SEARCH = "https://api.search.brave.com/res/v1/web/search";
const BRAVE_MAX_RESULTS = 20;

const BRAVE_FRESHNESS: Record<Freshness, string> = { day: "pd", week: "pw", month: "pm", year: "py" };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Brave snippets contain highlight markup like `<strong>` and HTML entities. */
export function stripHtml(text: string): string {
    return text
        .replace(/<[^>]+>/g, "")
        .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
            if (entity[0] === "#") {
                const code =
                    entity[1]?.toLowerCase() === "x" ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
                return Number.isFinite(code) ? String.fromCodePoint(code) : match;
            }
            return ENTITIES[entity.toLowerCase()] ?? match;
        })
        .trim();
}

export function braveQuery(request: SearchRequest): string {
    if (!request.domains?.length) return request.query;
    return `${request.query} ${request.domains.map((domain) => `site:${domain}`).join(" OR ")}`;
}

export async function searchBrave(
    request: SearchRequest,
    apiKey: string,
    fetchImpl: FetchLike = fetch,
): Promise<SearchResult> {
    const params = new URLSearchParams({
        q: braveQuery(request),
        count: String(Math.min(request.numResults, BRAVE_MAX_RESULTS)),
    });
    if (request.freshness) params.set("freshness", BRAVE_FRESHNESS[request.freshness]);

    const data = asRecord(
        await requestJson(fetchImpl, "Brave search", `${BRAVE_WEB_SEARCH}?${params}`, {
            headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
            signal: request.signal,
        }),
    );

    const hits = asArray(asRecord(data?.web)?.results).flatMap((item) => {
        const result = asRecord(item);
        const url = asString(result?.url);
        if (!result || !url) return [];
        const snippets = [asString(result.description), ...asArray(result.extra_snippets).map(asString)]
            .filter((text): text is string => Boolean(text))
            .map(stripHtml);
        return [
            {
                title: stripHtml(asString(result.title) ?? "") || url,
                url,
                published: asString(result.page_age)?.slice(0, 10) ?? asString(result.age),
                text: snippets.join("\n"),
            },
        ];
    });

    return { kind: "results", provider: "brave", hits: hits.slice(0, request.numResults) };
}
