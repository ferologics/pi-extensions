# VISION

pi-web is how a Pi agent searches the web and reads a page. It replaces a pile of overlapping tools (a Brave skill, a native-search skill, pi-antigravity's `google_search`) with two tools, `web_search` and `web_fetch`, in about a thousand lines you can read in one sitting.

## Goals

- **A small attack surface.** Every fetched page passes through this code, so it stays small, with few dependencies. It takes the useful slice of [pi-web-access](https://github.com/nicobailon/pi-web-access) and leaves out the MCP server, browser cookie access, the curator UI, and the long tail of providers.
- **Raw results first.** The default provider returns real pages and excerpts for the session's own model to read. Searching through another model (`claude`, `codex`, `google`) is opt-in, and the answer is labeled as that model's summary.
- **Defaults follow evidence.** Exa is the default because it leads independent benchmarks of search APIs for agents (the [Artificial Analysis Search Index](https://artificialanalysis.ai/agents/search-api)). If the evidence changes, the default changes.
- **A durable core, disposable extras.** Independent indexes behind plain REST APIs (Exa, Brave) are the part meant to last. The subscription-backed providers depend on pinned model names and upstream internals. When one breaks, it gets fixed or dropped, not worked around.
- **Explicit behavior.** The model picks the provider, and errors come back as they are. An Exa error suggests retrying with Brave, but nothing retries automatically. `web_fetch` reads the live page itself and sends the URL to Exa only when that fails.

## Direction

- Keep it to two tools. Pages that need a real browser (JavaScript, logins, clicks) belong to the web-browser skill, and repositories belong to librarian.
- Add a provider only when it beats the current ones on quality or durability, for example Perplexity Search or Brave's LLM Context endpoint.
- Check the benchmarks now and then, and keep the Maintenance list in `README.md` current.
