import {
    answerPrompt,
    asArray,
    asNumber,
    asRecord,
    asString,
    dedupeSources,
    type FetchLike,
    requestJson,
    type SearchRequest,
    type SearchResult,
    type Source,
} from "./results.js";

const ANTHROPIC_MESSAGES = "https://api.anthropic.com/v1/messages";
export const CLAUDE_SEARCH_MODEL = "claude-haiku-5-5";
const MAX_SEARCHES = 5;

// Claude subscription tokens get the same request identity pi-cc-patch gives Pi's own Anthropic requests.
const CLAUDE_CODE_VERSION = "2.1.280";
const BILLING_HEADER = `x-anthropic-billing-header: cc_version=${CLAUDE_CODE_VERSION}.000; cc_entrypoint=cli;`;
const SYSTEM_PROMPT = "You are a web research assistant. Search the web, then answer from what you found.";

function isSubscriptionToken(token: string): boolean {
    return token.startsWith("sk-ant-oat");
}

function headers(token: string): Record<string, string> {
    if (!isSubscriptionToken(token)) {
        return { "x-api-key": token, "anthropic-version": "2023-06-01", "Content-Type": "application/json" };
    }
    return {
        Authorization: `Bearer ${token}`,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "claude-code-20250219,oauth-2025-04-20",
        "Content-Type": "application/json",
        "user-agent": `claude-cli/${CLAUDE_CODE_VERSION} (external, cli)`,
        "x-app": "cli",
    };
}

export function buildClaudeRequest(request: SearchRequest, token: string): Record<string, unknown> {
    const tool: Record<string, unknown> = { type: "web_search_20250305", name: "web_search", max_uses: MAX_SEARCHES };
    if (request.domains?.length) tool.allowed_domains = request.domains;

    const system = [{ type: "text", text: SYSTEM_PROMPT }];
    if (isSubscriptionToken(token)) system.unshift({ type: "text", text: BILLING_HEADER });

    return {
        model: CLAUDE_SEARCH_MODEL,
        max_tokens: 4096,
        system,
        tools: [tool],
        messages: [{ role: "user", content: answerPrompt(request) }],
    };
}

export function parseClaudeResponse(data: unknown): SearchResult {
    const message = asRecord(data);
    const answerParts: string[] = [];
    const cited: Source[] = [];
    const searched: Source[] = [];
    const queries: string[] = [];
    const errors: string[] = [];

    for (const item of asArray(message?.content)) {
        const block = asRecord(item);
        if (!block) continue;
        if (block.type === "text") {
            answerParts.push(asString(block.text) ?? "");
            for (const citation of asArray(block.citations).map(asRecord)) {
                const url = asString(citation?.url);
                if (url) cited.push({ title: asString(citation?.title) ?? url, url });
            }
        } else if (block.type === "server_tool_use") {
            // Text before a search is narration ("I'll search for..."); the answer follows the last search.
            answerParts.length = 0;
            const query = asString(asRecord(block.input)?.query);
            if (query) queries.push(query);
        } else if (block.type === "web_search_tool_result") {
            const content = block.content;
            const error = asRecord(content);
            if (error?.type === "web_search_tool_result_error") errors.push(String(error.error_code));
            for (const result of asArray(content).map(asRecord)) {
                const url = asString(result?.url);
                if (url) searched.push({ title: asString(result?.title) ?? url, url });
            }
        }
    }

    // Claude splits a cited answer into adjacent text blocks, so they join without separators.
    const answer = answerParts.join("").trim();
    if (!answer) {
        const reason = errors.length ? `web search failed (${errors.join(", ")})` : "no answer text";
        throw new Error(`Claude search returned ${reason}.`);
    }

    const usage = asRecord(message?.usage);
    return {
        kind: "answer",
        provider: "claude",
        model: asString(message?.model) ?? CLAUDE_SEARCH_MODEL,
        answer,
        // Prefer the pages Claude cited; list everything it found only when it cited nothing.
        sources: dedupeSources(cited.length ? cited : searched),
        queries,
        tokens: usage
            ? {
                  input: asNumber(usage.input_tokens),
                  output: asNumber(usage.output_tokens),
                  cacheRead: asNumber(usage.cache_read_input_tokens),
                  cacheWrite: asNumber(usage.cache_creation_input_tokens),
              }
            : undefined,
    };
}

export async function searchClaude(
    request: SearchRequest,
    token: string,
    fetchImpl: FetchLike = fetch,
): Promise<SearchResult> {
    const data = await requestJson(fetchImpl, "Claude search", ANTHROPIC_MESSAGES, {
        method: "POST",
        headers: headers(token),
        body: JSON.stringify(buildClaudeRequest(request, token)),
        signal: request.signal,
    });
    return parseClaudeResponse(data);
}
