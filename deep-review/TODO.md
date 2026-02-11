# TODO

## Near-term priorities (updated)

Reference: `extensions/deep-review/ARCH.md`

### P0 — Runtime / performance

- [ ] Batch token estimation for related candidates (avoid one `tokencount` subprocess per file)
- [ ] Remove external `tokencount` dependency by embedding in-extension token counting (JS tokenizer path), keeping parity with current budgeting behavior.
- [ ] Add stage timing telemetry in report JSON (`git`, `scribe`, `filter`, `tokenize`, `render`)
- [ ] Reduce redundant render/tokenize loops where possible without losing deterministic guarantees
- [ ] Explore bounded Scribe concurrency with deterministic post-sort merge

### P1 — Selection policy quality

- [ ] Re-evaluate broad forced local-test inclusion (observed to improve some misses but displace runtime files)
- [ ] Define a generic default policy that does not overfit a single repo shape
- [ ] Add optional repo-level override mechanism (for example `.pi/context-pack.rules.yaml`) for project-specific priorities
- [ ] Add integration tests that assert mission-critical local code is not unexpectedly dropped in budget-tight runs
- [ ] Complete missing integration coverage for no-Scribe, partial-Scribe-failure, deterministic trimming, and baseline-over-budget paths

### P2 — UX controls for boundary cases

- [ ] Explore optional interactive omission arbitration loop (user chooses what to keep/drop under budget pressure)
- [ ] Explore optional advisory scoring pass (non-authoritative) for difficult tie-breaks

---

## Context-pack rewrite status (historical)

- Rewrite to direct in-extension TypeScript pipeline is complete.
- Historical implementation details now live in `ARCH.md`.
- Keep TODO focused on active/future work only.

## Add ChatGPT Codex backend path support

Goal: allow `/deep-review` to run with ChatGPT Plus/Pro OAuth (`openai-codex`) by supporting the Codex responses endpoint in addition to OpenAI Platform API.

### TODO

- [ ] Add dual-path request logic in `index.ts`:
  - Platform API path: `https://api.openai.com/v1/responses`
  - Codex subscription path: `https://chatgpt.com/backend-api/codex/responses`
- [ ] Auto-detect token/source and pick endpoint + headers accordingly
- [ ] Keep current Platform API behavior fully intact
- [ ] Validate parameter compatibility across both paths (effort/summary/verbosity/model IDs)
- [ ] Decide whether Codex path should become default when OAuth token is present
- [ ] Add docs to `README.md` for auth + endpoint routing behavior
- [ ] Add smoke tests for both auth modes (API key + OAuth)

### Exit criteria

- [ ] `/deep-review` works with either:
  - `OPENAI_API_KEY` (Platform)
  - `openai-codex` OAuth credentials from `~/.pi/agent/auth.json`
- [ ] No regression in output format, cost reporting, or debug artifacts
- [ ] Clear failure messages when selected auth/token cannot access selected endpoint

## Dynamic context budget for context packing

Goal: size `pr-context-packer --budget` from the selected model at runtime instead of using a fixed 272k default.

### TODO

- [ ] Resolve selected model limits via model registry (`contextWindow`, `maxTokens`) using provider + model ID
- [ ] Compute `Imax = contextWindow - reservedOutput` where:
  - `reservedOutput` defaults to model `maxTokens`
  - configurable headroom is applied (for system/tool overhead + safety)
- [ ] Pass computed budget to context packer (`--budget <Imax>`) from `/deep-review`
- [ ] Add fallback behavior when model metadata is missing (keep current 272k default)
- [ ] Include debug/report metadata showing computed budget math per run
- [ ] Document provider differences (`openai` 400k vs `openai-codex` 272k)

### Exit criteria

- [ ] Context pack budget automatically adapts to selected model/provider
- [ ] No context-overflow regressions in deep-review runs
- [ ] Reports clearly show the budget formula inputs and final budget

## Include AGENTS.md in packed context

Goal: consistently include local instruction files (like `AGENTS.md`) in review context to preserve repo-specific guidance.

### TODO

- [ ] Add optional include step in `pr-context-packer` for instruction files:
  - `AGENTS.md`
  - `CLAUDE.md`
  - `TODO.md` (optional toggle)
- [ ] Search scope strategy (repo root only vs nearest-up-tree + current subdir)
- [ ] Add dedupe + max-size guards so instruction docs do not crowd out code context
- [ ] Add flags to control behavior (for example `--include-instructions` / `--no-include-instructions`)
- [ ] Surface included instruction files in manifests/report for transparency

### Exit criteria

- [ ] Instruction files are included predictably when enabled
- [ ] Token budget impact is bounded and visible
- [ ] No duplicate or irrelevant instruction files are injected
