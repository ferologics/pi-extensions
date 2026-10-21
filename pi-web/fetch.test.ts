import { describe, expect, it, vi } from "vitest";
import { fetchPage, htmlToMarkdown, parseHttpUrl } from "./fetch.js";
import type { FetchLike } from "./results.js";

const paragraph = "Exa 3.0 adds a cheaper Lite search type and a larger index for agents. ".repeat(6);
const articleHtml = `<!doctype html><html><head><title>Exa 3.0</title></head><body>
<nav><a href="/">Home</a></nav>
<article><h1>Introducing Exa 3.0</h1><p>${paragraph}</p><h2>Pricing</h2>
<table><thead><tr><th>Type</th><th>Price</th></tr></thead><tbody><tr><td>Lite</td><td>$4</td></tr></tbody></table>
<pre><code>curl https://api.exa.ai/search</code></pre></article>
<footer>Footer links</footer></body></html>`;

function htmlResponse(body: string, contentType = "text/html; charset=utf-8", status = 200): Response {
    return new Response(body, { status, headers: { "content-type": contentType } });
}

describe("parseHttpUrl", () => {
    it("accepts http(s) URLs only", () => {
        expect(parseHttpUrl("https://exa.ai/blog").hostname).toBe("exa.ai");
        expect(() => parseHttpUrl("file:///etc/passwd")).toThrow(/Only http\(s\)/);
        expect(() => parseHttpUrl("not a url")).toThrow(/Invalid URL/);
    });
});

describe("htmlToMarkdown", () => {
    it("keeps headings, tables, and fenced code", () => {
        const markdown = htmlToMarkdown(
            "<h2>Pricing</h2><table><thead><tr><th>Type</th><th>Price</th></tr></thead><tbody><tr><td>Lite</td><td>$4</td></tr></tbody></table><pre><code>exa search</code></pre>",
        );
        expect(markdown).toContain("## Pricing");
        expect(markdown).toContain("| Type | Price |");
        expect(markdown).toContain("```\nexa search\n```");
    });
});

describe("fetchPage", () => {
    it("returns the readable article as markdown", async () => {
        const fetchMock = vi.fn<FetchLike>().mockResolvedValue(htmlResponse(articleHtml));
        const page = await fetchPage("https://exa.ai/blog/exa-3", undefined, fetchMock);

        expect(page.title).toBe("Exa 3.0");
        expect(page.text).toContain("Introducing Exa 3.0");
        expect(page.text).toContain("| Lite | $4 |");
        expect(page.text).not.toContain("Footer links");
    });

    it("returns non-HTML text bodies as-is", async () => {
        const fetchMock = vi.fn<FetchLike>().mockResolvedValue(htmlResponse('{"ok":true}', "application/json"));
        await expect(fetchPage("https://api.example.com/status", undefined, fetchMock)).resolves.toEqual({
            url: "https://api.example.com/status",
            text: '{"ok":true}',
        });
    });

    it("rejects HTTP errors, binary content, and pages without readable content", async () => {
        const fetchMock = vi
            .fn<FetchLike>()
            .mockResolvedValueOnce(htmlResponse("blocked", "text/html", 403))
            .mockResolvedValueOnce(htmlResponse("%PDF-1.7", "application/pdf"))
            .mockResolvedValueOnce(htmlResponse('<html><body><div id="root"></div></body></html>'));

        await expect(fetchPage("https://example.com/a", undefined, fetchMock)).rejects.toThrow(/HTTP 403/);
        await expect(fetchPage("https://example.com/b.pdf", undefined, fetchMock)).rejects.toThrow(/application\/pdf/);
        await expect(fetchPage("https://example.com/app", undefined, fetchMock)).rejects.toThrow(/needs? JavaScript/);
    });
});
