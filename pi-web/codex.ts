import {
    answerPrompt,
    asArray,
    asNumber,
    asRecord,
    asString,
    dedupeSources,
    type FetchLike,
    type ModelTokens,
    type SearchRequest,
    type SearchResult,
    type Source,
} from "./results.js";

const CODEX_RESPONSES = "https://chatgpt.com/backend-api/codex/responses";
export const CODEX_SEARCH_MODEL = "gpt-6-luna";
const SYSTEM_PROMPT = "You are a web research assistant. Search the web, then answer from what you found.";

export function codexAccountId(token: string): string {
    try {
        const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
        const accountId = payload?.["https://api.openai.com/auth"]?.chatgpt_account_id;
        if (typeof accountId === "string" && accountId) return accountId;
    } catch {
        // Fall through to the error below.
    }
    throw new Error("Could not read the ChatGPT account id from the openai-codex token. Run /login openai-codex.");
}

/** OpenAI tags cited links with utm_source=openai. */
export function cleanCitationUrl(url: string): string {
    try {
        const parsed = new URL(url);
        if (parsed.searchParams.get("utm_source") === "openai") parsed.searchParams.delete("utm_source");
        return parsed.toString();
    } catch {
        return url;
    }
}

export function buildCodexRequest(request: SearchRequest): Record<string, unknown> {
    const tool: Record<string, unknown> = { type: "web_search" };
    if (request.domains?.length) tool.filters = { allowed_domains: request.domains };
    return {
        model: CODEX_SEARCH_MODEL,
        store: false,
        stream: true,
        instructions: SYSTEM_PROMPT,
        input: [{ role: "user", content: answerPrompt(request) }],
        tools: [tool],
        tool_choice: "auto",
        reasoning: { effort: "low" },
    };
}

function* streamEvents(body: string): Generator<Record<string, unknown>> {
    for (const chunk of body.split(/\r?\n\r?\n/)) {
        const data = chunk
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .join("\n");
        if (!data || data === "[DONE]") continue;
        try {
            const event = asRecord(JSON.parse(data));
            if (event) yield event;
        } catch {
            // Ignore keep-alives and partial frames.
        }
    }
}

export function parseCodexStream(body: string): SearchResult {
    let deltas = "";
    const messages: string[] = [];
    const sources: Source[] = [];
    const queries: string[] = [];
    let tokens: ModelTokens | undefined;
    let model = CODEX_SEARCH_MODEL;

    for (const event of streamEvents(body)) {
        if (event.type === "error")
            throw new Error(`Codex search failed: ${asString(event.message) ?? "stream error"}`);
        if (event.type === "response.failed") {
            const error = asRecord(asRecord(event.response)?.error);
            throw new Error(`Codex search failed: ${asString(error?.message) ?? "response failed"}`);
        }
        if (event.type === "response.output_text.delta") deltas += asString(event.delta) ?? "";
        if (event.type === "response.output_item.done") {
            const item = asRecord(event.item);
            if (item?.type === "web_search_call") {
                const action = asRecord(item.action);
                const searched = asArray(action?.queries).map(asString);
                queries.push(
                    ...(searched.length ? searched : [asString(action?.query)]).filter((q): q is string => !!q),
                );
            }
            if (item?.type === "message") {
                for (const part of asArray(item.content).map(asRecord)) {
                    if (part?.type !== "output_text") continue;
                    messages.push(asString(part.text) ?? "");
                    for (const annotation of asArray(part.annotations).map(asRecord)) {
                        const url = asString(annotation?.url);
                        if (annotation?.type === "url_citation" && url) {
                            const clean = cleanCitationUrl(url);
                            sources.push({ title: asString(annotation.title) ?? clean, url: clean });
                        }
                    }
                }
            }
        }
        if (event.type === "response.completed") {
            const response = asRecord(event.response);
            model = asString(response?.model) ?? model;
            const usage = asRecord(response?.usage);
            if (usage) {
                const cached = asNumber(asRecord(usage.input_tokens_details)?.cached_tokens);
                tokens = {
                    input: asNumber(usage.input_tokens) - cached,
                    output: asNumber(usage.output_tokens),
                    cacheRead: cached,
                    cacheWrite: 0,
                };
            }
        }
    }

    const answer = (messages.join("\n\n") || deltas)
        .trim()
        .replace(/https?:\/\/[^\s)\]]+utm_source=openai[^\s)\]]*/g, cleanCitationUrl);
    if (!answer) throw new Error("Codex search returned no answer text.");
    return {
        kind: "answer",
        provider: "codex",
        model,
        answer,
        sources: dedupeSources(sources),
        queries: [...new Set(queries)],
        tokens,
    };
}

export async function searchCodex(
    request: SearchRequest,
    token: string,
    fetchImpl: FetchLike = fetch,
): Promise<SearchResult> {
    const response = await fetchImpl(CODEX_RESPONSES, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "chatgpt-account-id": codexAccountId(token),
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            "OpenAI-Beta": "responses=experimental",
            originator: "pi-web",
        },
        body: JSON.stringify(buildCodexRequest(request)),
        signal: request.signal,
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`Codex search request failed (HTTP ${response.status}): ${body.slice(0, 500)}`);
    return parseCodexStream(body);
}
