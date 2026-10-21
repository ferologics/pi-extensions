import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { type FetchLike, withTimeout } from "./results.js";

const FETCH_TIMEOUT_MS = 20_000;
const MIN_CONTENT_CHARS = 200;
const USER_AGENT =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

export interface Page {
    title?: string;
    url: string;
    text: string;
}

export function parseHttpUrl(url: string): URL {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error(`Invalid URL: ${url}`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error(`Only http(s) URLs can be fetched: ${url}`);
    }
    return parsed;
}

export function htmlToMarkdown(html: string): string {
    const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
    turndown.use(gfm);
    turndown.addRule("removeEmptyLinks", {
        filter: (node) => node.nodeName === "A" && !node.textContent?.trim(),
        replacement: () => "",
    });
    return turndown
        .turndown(html)
        .replace(/\[\\?\[\s*\\?\]\]\([^)]*\)/g, "")
        .replace(/ +/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

export function extractReadable(html: string, url: string): { title?: string; markdown: string } {
    const article = new Readability(new JSDOM(html, { url }).window.document).parse();
    if (article?.content) {
        return { title: article.title?.trim() || undefined, markdown: htmlToMarkdown(article.content) };
    }

    const document = new JSDOM(html, { url }).window.document;
    for (const element of document.querySelectorAll("script, style, noscript, nav, header, footer, aside")) {
        element.remove();
    }
    const main = document.querySelector("main, article, [role='main'], .content, #content") ?? document.body;
    return {
        title: document.querySelector("title")?.textContent?.trim() || undefined,
        markdown: htmlToMarkdown(main?.innerHTML ?? ""),
    };
}

function isTextual(contentType: string): boolean {
    return (
        contentType.startsWith("text/") ||
        /\b(json|xml|javascript|yaml|toml|csv)\b/.test(contentType) ||
        contentType.includes("+json") ||
        contentType.includes("+xml")
    );
}

/** Fetch a page directly and return readable markdown, or the raw body for non-HTML text. */
export async function fetchPage(url: string, signal?: AbortSignal, fetchImpl: FetchLike = fetch): Promise<Page> {
    parseHttpUrl(url);
    const response = await fetchImpl(url, {
        headers: {
            "User-Agent": USER_AGENT,
            Accept: "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        },
        redirect: "follow",
        signal: withTimeout(signal, FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);

    const finalUrl = response.url || url;
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    const isHtml = contentType.includes("html") || contentType === "";
    if (!isHtml && !isTextual(contentType)) {
        throw new Error(`Unsupported content type ${contentType} at ${url}`);
    }

    const body = await response.text();
    if (!isHtml) return { url: finalUrl, text: body };

    const { title, markdown } = extractReadable(body, finalUrl);
    if (markdown.length < MIN_CONTENT_CHARS) {
        throw new Error(`Could not extract readable content from ${url} (page may need JavaScript)`);
    }
    return { title, url: finalUrl, text: markdown };
}
