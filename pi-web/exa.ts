import {
    asArray,
    asNumber,
    asRecord,
    asString,
    type FetchLike,
    freshnessStart,
    requestJson,
    type SearchRequest,
    type SearchResult,
} from "./results.js";

const EXA_API = "https://api.exa.ai";
// Dynamic Highlights still requires this beta header on the API.
const DYNAMIC_HIGHLIGHTS_BETA = "dynamic-highlights-2026-08-28";

export interface ExaPage {
    title: string;
    url: string;
    published?: string;
    text: string;
}

function headers(apiKey: string): Record<string, string> {
    return {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "Exa-Beta": DYNAMIC_HIGHLIGHTS_BETA,
    };
}

export async function searchExa(
    request: SearchRequest,
    apiKey: string,
    fetchImpl: FetchLike = fetch,
    now = new Date(),
): Promise<SearchResult> {
    const body: Record<string, unknown> = {
        query: request.query,
        type: "auto",
        numResults: request.numResults,
        contents: { highlights: { dynamic: true } },
    };
    if (request.freshness) body.startPublishedDate = freshnessStart(request.freshness, now).toISOString();
    if (request.domains?.length) body.includeDomains = request.domains;

    const data = asRecord(
        await requestJson(fetchImpl, "Exa search", `${EXA_API}/search`, {
            method: "POST",
            headers: headers(apiKey),
            body: JSON.stringify(body),
            signal: request.signal,
        }),
    );

    const hits = asArray(data?.results).flatMap((item) => {
        const result = asRecord(item);
        const url = asString(result?.url);
        if (!result || !url) return [];
        const highlights = asArray(result.highlights).filter((text): text is string => typeof text === "string");
        return [
            {
                title: asString(result.title)?.trim() || url,
                url,
                published: asString(result.publishedDate)?.slice(0, 10),
                text: highlights.join("\n\n").trim(),
            },
        ];
    });

    const cost = asRecord(data?.costDollars);
    return { kind: "results", provider: "exa", hits, costUsd: cost ? asNumber(cost.total) : undefined };
}

export async function fetchExaPage(
    url: string,
    apiKey: string,
    signal?: AbortSignal,
    fetchImpl: FetchLike = fetch,
): Promise<ExaPage> {
    const data = asRecord(
        await requestJson(fetchImpl, "Exa contents", `${EXA_API}/contents`, {
            method: "POST",
            headers: headers(apiKey),
            body: JSON.stringify({ urls: [url], text: true }),
            signal,
        }),
    );

    const status = asRecord(asArray(data?.statuses)[0]);
    if (status && status.status !== "success") {
        throw new Error(`Exa could not fetch ${url}: ${JSON.stringify(status.error ?? status.status)}`);
    }

    const result = asRecord(asArray(data?.results)[0]);
    const text = asString(result?.text)?.trim();
    if (!result || !text) throw new Error(`Exa returned no content for ${url}`);

    return {
        title: asString(result.title)?.trim() || url,
        url: asString(result.url) ?? url,
        published: asString(result.publishedDate)?.slice(0, 10),
        text,
    };
}
