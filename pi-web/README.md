# pi-web

Web search and page reading for Pi. A single `web_search` tool covers five providers, and `web_fetch` reads one page. There is no MCP server, curator UI, cookie access, or provider fallback chain. The model picks the provider, and errors come back as they are.

## Tools

| Tool         | Behavior                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------- |
| `web_search` | Search with `exa` (default), `brave`, `claude`, `codex`, or `google`. Optional `numResults`, `freshness`, `domains` |
| `web_fetch`  | Read a URL as markdown. It fetches the page directly, then falls back to Exa's page cache when `EXA_API_KEY` is set |

Output over Pi's tool limits (2000 lines or 50KB) is truncated, and the full text is saved to a temp file whose path appears in the result.

## Providers

| Provider | Returns                                      | Credentials                                      |
| -------- | -------------------------------------------- | ------------------------------------------------ |
| `exa`    | Ranked pages with query-relevant excerpts    | `EXA_API_KEY`                                    |
| `brave`  | Ranked pages with snippets                   | `BRAVE_API_KEY`                                  |
| `claude` | Cited summary from Claude's web search tool  | Pi `anthropic` login (subscription or API key)   |
| `codex`  | Cited summary from Codex's web search tool   | Pi `openai-codex` login                          |
| `google` | Cited summary from Gemini's Google grounding | `npm:pi-antigravity` and its `antigravity` login |

- `exa` searches with `type: "auto"` and Dynamic Highlights. When it fails, the error tells the model to retry with `brave`.
- `brave` uses the plain web search endpoint and adds `site:` operators for `domains`.
- `claude` runs `claude-haiku-5-5` with up to 5 searches. Subscription tokens get the same billing identity that `pi-cc-patch` gives Pi's own Anthropic requests.
- `codex` runs `gpt-6-luna` at low reasoning effort with Codex's `web_search` tool.
- `google` calls pi-antigravity's own search function, then resolves Google's opaque grounding redirect links to the real URLs. Set `ANTIGRAVITY_NO_SEARCH_TOOL=1` so pi-antigravity does not also register its `google_search` tool.

Answers from `claude`, `codex`, and `google` are labeled as another model's summary. Their token usage is reported on the tool result, so session totals include it.

## Install

From npm (standalone package):

```bash
pi install npm:@ferologics/pi-web
```

From git:

```bash
pi install git:github.com/ferologics/pi-web
```

Or use the bundled package:

```bash
pi install npm:@ferologics/pi-extensions
# or
pi install npm:pi-shit
```

## Setup

Expose the API keys to Pi:

```text
EXA_API_KEY=...
BRAVE_API_KEY=...
```

In the dotfiles setup, store each key in 1Password, add only its `op://...` reference to `~/.pi/agent/env.op`, run `pi-secrets-refresh`, and restart Pi.

The `claude`, `codex`, and `google` providers reuse Pi's logins (`/login anthropic`, `/login openai-codex`, `/login antigravity`).

## Maintenance

These constants follow upstream releases and need updating when a provider rejects them:

- `CLAUDE_SEARCH_MODEL` and `CLAUDE_CODE_VERSION` in `claude.ts`. Keep the version in step with `pi-cc-patch`.
- `CODEX_SEARCH_MODEL` in `codex.ts`.
- `DYNAMIC_HIGHLIGHTS_BETA` in `exa.ts`, until Exa drops the beta header.
- The pi-antigravity module path in `index.ts` (`src/search/index.ts` inside the installed package).

## Privacy

- Search queries go to the selected provider.
- `web_fetch` requests the page from this machine. When that fails, the URL is sent to Exa.
- Returned page text becomes part of the Pi conversation and is sent to the active model provider.
