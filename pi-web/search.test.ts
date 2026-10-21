import { describe, expect, it, vi } from "vitest";
import { searchBrave, stripHtml } from "./brave.js";
import { buildClaudeRequest, parseClaudeResponse } from "./claude.js";
import { buildCodexRequest, cleanCitationUrl, codexAccountId, parseCodexStream } from "./codex.js";
import { fetchExaPage, searchExa } from "./exa.js";
import { resolveGroundingRedirects, searchGoogle } from "./google.js";
import { type FetchLike, formatSearchResult, type SearchRequest } from "./results.js";

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function requestBody(fetchMock: ReturnType<typeof vi.fn<FetchLike>>, call = 0): Record<string, unknown> {
    return JSON.parse(String(fetchMock.mock.calls[call]?.[1]?.body));
}

const request: SearchRequest = { query: "exa pricing", numResults: 3 };

describe("exa", () => {
    it("searches with dynamic highlights, filters, and returns ranked excerpts", async () => {
        const fetchMock = vi.fn<FetchLike>().mockResolvedValue(
            jsonResponse({
                results: [
                    {
                        title: "Introducing Exa 3.0",
                        url: "https://exa.ai/blog/exa-3",
                        publishedDate: "2026-10-19T20:12:36.000Z",
                        highlights: ["Lite costs $4", "Auto costs $7"],
                    },
                    { title: "", url: "https://exa.ai/pricing", highlights: [] },
                ],
                costDollars: { total: 0.007 },
            }),
        );

        const result = await searchExa(
            { ...request, freshness: "week", domains: ["exa.ai"] },
            "exa-key",
            fetchMock,
            new Date("2026-10-20T00:00:00.000Z"),
        );

        const [url, init] = fetchMock.mock.calls[0]!;
        expect(url).toBe("https://api.exa.ai/search");
        expect(init?.headers).toMatchObject({ "x-api-key": "exa-key", "Exa-Beta": "dynamic-highlights-2026-08-28" });
        expect(requestBody(fetchMock)).toEqual({
            query: "exa pricing",
            type: "auto",
            numResults: 3,
            contents: { highlights: { dynamic: true } },
            startPublishedDate: "2026-10-13T00:00:00.000Z",
            includeDomains: ["exa.ai"],
        });
        expect(result).toEqual({
            kind: "results",
            provider: "exa",
            costUsd: 0.007,
            hits: [
                {
                    title: "Introducing Exa 3.0",
                    url: "https://exa.ai/blog/exa-3",
                    published: "2026-10-19",
                    text: "Lite costs $4\n\nAuto costs $7",
                },
                { title: "https://exa.ai/pricing", url: "https://exa.ai/pricing", published: undefined, text: "" },
            ],
        });
    });

    it("surfaces API errors with the status and body", async () => {
        const fetchMock = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({ error: "out of credits" }, 402));
        await expect(searchExa(request, "exa-key", fetchMock)).rejects.toThrow(/HTTP 402.*out of credits/);
    });

    it("fetches page text and reports per-URL fetch failures", async () => {
        const fetchMock = vi
            .fn<FetchLike>()
            .mockResolvedValueOnce(
                jsonResponse({
                    results: [{ title: "Exa 3.0", url: "https://exa.ai/blog/exa-3", text: "# Exa 3.0\nBody" }],
                    statuses: [{ id: "https://exa.ai/blog/exa-3", status: "success" }],
                }),
            )
            .mockResolvedValueOnce(
                jsonResponse({
                    results: [],
                    statuses: [{ status: "error", error: { tag: "SOURCE_NOT_AVAILABLE", httpStatusCode: 403 } }],
                }),
            );

        await expect(fetchExaPage("https://exa.ai/blog/exa-3", "exa-key", undefined, fetchMock)).resolves.toEqual({
            title: "Exa 3.0",
            url: "https://exa.ai/blog/exa-3",
            published: undefined,
            text: "# Exa 3.0\nBody",
        });
        await expect(fetchExaPage("https://reddit.com/", "exa-key", undefined, fetchMock)).rejects.toThrow(
            /SOURCE_NOT_AVAILABLE/,
        );
    });
});

describe("brave", () => {
    it("strips highlight markup and HTML entities", () => {
        expect(stripHtml("<strong>Exa</strong> &amp; Brave&#x27;s &quot;API&quot; &#8212; ok")).toBe(
            `Exa & Brave's "API" — ok`,
        );
    });

    it("maps freshness and domains onto the web search endpoint", async () => {
        const fetchMock = vi.fn<FetchLike>().mockResolvedValue(
            jsonResponse({
                web: {
                    results: [
                        {
                            title: "<strong>Exa</strong> 3.0",
                            url: "https://exa.ai/blog/exa-3",
                            description: "Lite is <strong>$4</strong>",
                            page_age: "2026-10-19T00:00:00",
                        },
                    ],
                },
            }),
        );

        const result = await searchBrave(
            { ...request, freshness: "month", domains: ["exa.ai", "github.com"] },
            "brave-key",
            fetchMock,
        );

        const url = new URL(String(fetchMock.mock.calls[0]![0]));
        expect(url.searchParams.get("q")).toBe("exa pricing site:exa.ai OR site:github.com");
        expect(url.searchParams.get("freshness")).toBe("pm");
        expect(url.searchParams.get("count")).toBe("3");
        expect(fetchMock.mock.calls[0]![1]?.headers).toMatchObject({ "X-Subscription-Token": "brave-key" });
        expect(result).toEqual({
            kind: "results",
            provider: "brave",
            hits: [{ title: "Exa 3.0", url: "https://exa.ai/blog/exa-3", published: "2026-10-19", text: "Lite is $4" }],
        });
    });
});

describe("claude", () => {
    it("sends subscription tokens with the Claude Code billing identity", () => {
        const body = buildClaudeRequest({ ...request, domains: ["exa.ai"] }, "sk-ant-oat01-token");
        expect(body.system).toEqual([
            { type: "text", text: "x-anthropic-billing-header: cc_version=2.1.280.000; cc_entrypoint=cli;" },
            expect.objectContaining({ type: "text" }),
        ]);
        expect(body.tools).toEqual([
            { type: "web_search_20250305", name: "web_search", max_uses: 5, allowed_domains: ["exa.ai"] },
        ]);
        expect(buildClaudeRequest(request, "sk-ant-api03-key").system).toHaveLength(1);
    });

    it("keeps the answer after the last search and prefers cited sources", () => {
        const result = parseClaudeResponse({
            model: "claude-haiku-5-5",
            content: [
                { type: "text", text: "I'll search for that." },
                { type: "server_tool_use", input: { query: "exa 3.0 pricing" } },
                {
                    type: "web_search_tool_result",
                    content: [
                        { type: "web_search_result", url: "https://exa.ai/blog/exa-3", title: "Exa 3.0" },
                        { type: "web_search_result", url: "https://example.com/other", title: "Other" },
                    ],
                },
                { type: "text", text: "Lite is " },
                {
                    type: "text",
                    text: "$4 per 1,000 requests",
                    citations: [{ url: "https://exa.ai/blog/exa-3", title: "Exa 3.0" }],
                },
                { type: "text", text: "." },
            ],
            usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: 0 },
        });

        expect(result).toEqual({
            kind: "answer",
            provider: "claude",
            model: "claude-haiku-5-5",
            answer: "Lite is $4 per 1,000 requests.",
            sources: [{ title: "Exa 3.0", url: "https://exa.ai/blog/exa-3" }],
            queries: ["exa 3.0 pricing"],
            tokens: { input: 100, output: 20, cacheRead: 5, cacheWrite: 0 },
        });
    });

    it("reports web search errors when there is no answer", () => {
        expect(() =>
            parseClaudeResponse({
                content: [
                    {
                        type: "web_search_tool_result",
                        content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" },
                    },
                ],
            }),
        ).toThrow(/max_uses_exceeded/);
    });
});

describe("codex", () => {
    const token = `x.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acct_1" } })).toString("base64url")}.y`;

    it("reads the ChatGPT account id from the token", () => {
        expect(codexAccountId(token)).toBe("acct_1");
        expect(() => codexAccountId("not-a-jwt")).toThrow(/account id/);
    });

    it("passes domain filters to the web_search tool", () => {
        expect(buildCodexRequest({ ...request, domains: ["github.com"] }).tools).toEqual([
            { type: "web_search", filters: { allowed_domains: ["github.com"] } },
        ]);
    });

    it("parses the answer, citations, searches, and usage from the event stream", () => {
        const events = [
            { type: "response.output_text.delta", delta: "partial" },
            {
                type: "response.output_item.done",
                item: { type: "web_search_call", action: { type: "search", queries: ["exa pricing", "exa lite"] } },
            },
            {
                type: "response.output_item.done",
                item: {
                    type: "message",
                    content: [
                        {
                            type: "output_text",
                            text: "Lite is $4. ([exa.ai](https://exa.ai/pricing?utm_source=openai))",
                            annotations: [
                                {
                                    type: "url_citation",
                                    url: "https://exa.ai/pricing?utm_source=openai",
                                    title: "Pricing",
                                },
                            ],
                        },
                    ],
                },
            },
            {
                type: "response.completed",
                response: {
                    model: "gpt-6-luna",
                    usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 40 }, output_tokens: 10 },
                },
            },
        ];
        const body = `${events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}`).join("\n\n")}\n\ndata: [DONE]\n\n`;

        expect(parseCodexStream(body)).toEqual({
            kind: "answer",
            provider: "codex",
            model: "gpt-6-luna",
            answer: "Lite is $4. ([exa.ai](https://exa.ai/pricing))",
            sources: [{ title: "Pricing", url: "https://exa.ai/pricing" }],
            queries: ["exa pricing", "exa lite"],
            tokens: { input: 60, output: 10, cacheRead: 40, cacheWrite: 0 },
        });
    });

    it("throws stream failures", () => {
        const body = `data: ${JSON.stringify({ type: "response.failed", response: { error: { message: "model not supported" } } })}\n\n`;
        expect(() => parseCodexStream(body)).toThrow(/model not supported/);
    });

    it("keeps non-OpenAI query parameters on citations", () => {
        expect(cleanCitationUrl("https://example.com/a?utm_source=newsletter")).toBe(
            "https://example.com/a?utm_source=newsletter",
        );
    });
});

describe("google", () => {
    const redirect = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQ_abc-123==";

    it("replaces grounding redirect links with their targets", async () => {
        const fetchMock = vi
            .fn<FetchLike>()
            .mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://exa.ai/blog/exa-3" } }));

        const markdown = `Answer\n\n### Sources\n- [exa.ai](${redirect})\n- [again](${redirect})`;
        await expect(resolveGroundingRedirects(markdown, fetchMock)).resolves.toBe(
            "Answer\n\n### Sources\n- [exa.ai](https://exa.ai/blog/exa-3)\n- [again](https://exa.ai/blog/exa-3)",
        );
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0]![1]).toMatchObject({ redirect: "manual" });
    });

    it("keeps links that cannot be resolved", async () => {
        const fetchMock = vi.fn<FetchLike>().mockRejectedValue(new Error("offline"));
        await expect(resolveGroundingRedirects(`see ${redirect}`, fetchMock)).resolves.toBe(`see ${redirect}`);
    });

    it("passes filters to Antigravity as a search directive", async () => {
        const executeAntigravitySearch = vi.fn().mockResolvedValue("Gemini answer");
        const result = await searchGoogle(
            { ...request, freshness: "year", domains: ["exa.ai"] },
            "antigravity-key",
            { executeAntigravitySearch },
            vi.fn<FetchLike>(),
        );

        expect(executeAntigravitySearch).toHaveBeenCalledWith({
            apiKey: "antigravity-key",
            query: "exa pricing",
            instruction: "Only use sources from: exa.ai. Only use sources published within the past year.",
            signal: undefined,
        });
        expect(result).toMatchObject({ kind: "answer", provider: "google", answer: "Gemini answer" });
    });
});

describe("formatSearchResult", () => {
    it("numbers raw results", () => {
        expect(
            formatSearchResult({
                kind: "results",
                provider: "exa",
                hits: [
                    { title: "Exa 3.0", url: "https://exa.ai/blog/exa-3", published: "2026-10-19", text: "Lite is $4" },
                ],
            }),
        ).toBe("exa: 1 result\n\n[1] Exa 3.0\nhttps://exa.ai/blog/exa-3\nPublished: 2026-10-19\n\nLite is $4");
    });

    it("labels answers as another model's summary and lists sources and searches", () => {
        expect(
            formatSearchResult({
                kind: "answer",
                provider: "codex",
                model: "gpt-6-luna",
                answer: "Lite is $4.",
                sources: [{ title: "Pricing", url: "https://exa.ai/pricing" }],
                queries: ["exa pricing"],
            }),
        ).toBe(
            "codex (gpt-6-luna) answer. This is another model's summary; verify key claims with web_fetch.\n\n" +
                'Lite is $4.\n\nSources:\n- Pricing: https://exa.ai/pricing\n\nSearches: "exa pricing"',
        );
    });
});
