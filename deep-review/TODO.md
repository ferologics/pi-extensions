# TODO

## Near-term priorities (updated)

Reference: `extensions/deep-review/ARCH.md`

### P0 — Runtime / performance

- [ ] Batch token estimation for related candidates (avoid one `tokencount` subprocess per file)
- [ ] Remove external `tokencount` dependency by embedding in-extension token counting (JS tokenizer path), keeping parity with current budgeting behavior.
- [ ] Add automatic context-pack cache keyed by repo/base/head + pack-affecting options, so repeated `/deep-review` runs can reuse a previous pack instead of rebuilding it every time.
- [ ] Decide cache invalidation + UX (`cache hit` reporting, explicit refresh, interaction with manual `--context-pack` reuse).
- [ ] Add stage timing telemetry in report JSON (`git`, `scribe`, `filter`, `tokenize`, `render`)
- [ ] Reduce redundant render/tokenize loops where possible without losing deterministic guarantees
- [ ] Explore bounded Scribe concurrency with deterministic post-sort merge

### P1 — Recall / selection policy quality

- [ ] Re-evaluate broad forced local-test inclusion (observed to improve some misses but displace runtime files)
- [ ] Define a generic default policy that does not overfit a single repo shape
- [ ] Prototype adaptive Scribe recall profiles (unbounded default + optional bounded fallback passes) and benchmark quality/runtime tradeoffs.
- [ ] Add report metadata for recall mode/profile + any Scribe bounds used so omissions stay explainable.
- [ ] Add optional repo-level override mechanism (for example `.pi/context-pack.rules.yaml`) for project-specific priorities
- [ ] Add integration tests that assert mission-critical local code is not unexpectedly dropped in budget-tight runs
- [ ] Complete missing integration coverage for no-Scribe, partial-Scribe-failure, deterministic trimming, and baseline-over-budget paths
- [ ] Evaluate bounded-recall fallback outcomes vs rank-tail-trim outcomes across at least 2 repo shapes before changing defaults.

### P2 — UX controls for boundary cases

- [ ] Explore optional interactive omission arbitration loop (user chooses what to keep/drop under budget pressure)
- [ ] Explore optional advisory scoring pass (non-authoritative) for difficult tie-breaks

### P3 — Maintainability / structure

- [ ] Split `extensions/deep-review/index.ts` into focused modules (`budget`, `responses`, `artifacts`, `ui`) once current behavior stabilizes; keep behavior identical.
- [ ] Add focused tests around request building, auth source selection, SSE/error handling, and final report rendering so the split is safe.

## Replace external Scribe with internal minimal recall engine

Goal: remove runtime dependency on external `@sibyllinesoft/scribe` CLI and own only the recall logic we actually need for deep-review.

### Research conclusions (2026-02-12)

- Keep: diff-seeded dependency closure, include-dependents option, distance/reason metadata, deterministic ordering, explicit omission reasons.
- Lift from CodeMapper: two-stage retrieval (text prefilter -> AST validation), incremental cache (size/mtime prefilter + hash confirm), impact/test-risk signals (callers/tests/untested), signature-change risk cues.
- Drop: agent install hooks, bundle/web/editor outputs, output-style surface area, webservice/npm packaging, generic repo bundling.
- Licensing note: CodeMapper repository currently has no explicit license file; reimplement ideas, do not copy code verbatim.

### TODO

- [ ] Create a small Rust crate (working name: `deep-review-recall`) with stable machine-readable output for context-pack.
- [ ] Implement graph build + closure from changed files in one pass (dependencies + optional dependents + depth cap), replacing per-target CLI fan-out.
- [ ] Implement language scope intentionally (Rust + TS/JS first; Python optional later), with deterministic import path resolution.
- [ ] Add fast mode for large repos: ripgrep/text prefilter first, syntax/AST validation second.
- [ ] Add incremental cache + invalidation with deterministic metadata updates.
- [ ] Add ranking risk overlay (`fanout`, `test-coverage`, `signature-change`, `recent-churn`) while keeping omission explainability.
- [ ] Emit structured artifacts consumed directly by `context-pack/index.ts` (remove XML scraping glue).
- [ ] Add parity benchmark suite vs current Scribe-backed pipeline across at least 2 repo shapes (quality + runtime + token fit) before default switch.
- [ ] Keep temporary fallback flag to external Scribe during rollout; remove fallback once parity gate is met.

### Exit criteria

- [ ] `/deep-review` runs without external Scribe dependency.
- [ ] Recall quality is equal or better on regression corpus.
- [ ] Runtime improves and variance drops on large repos.
- [ ] Report/manifests preserve deterministic and auditable omission reasons.

---

## Context-pack rewrite status (historical)

- Rewrite to direct in-extension TypeScript pipeline is complete.
- Historical implementation details now live in `ARCH.md`.
- Keep TODO focused on active/future work only.

## Add ChatGPT Codex backend path support

Goal: allow `/deep-review` to run with ChatGPT Plus/Pro OAuth (`openai-codex`) by supporting the Codex responses endpoint in addition to OpenAI Platform API.

### Research pointer

For prior investigation into ChatGPT/Codex subscription support and endpoint-routing ideas, see Pi session:

- `7f8bc5ce-d477-44ee-8d75-72ef0c243d3a`

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

Goal: keep the new model-aware context budget policy stable, explainable, and safe across provider/model changes.

### Current behavior

- Auto-sizing is implemented in `/deep-review`.
- Current input-budget policy is:
  - start with `min(contextWindow - maxTokens, 75% of contextWindow)`
  - then subtract request headroom (query + protocol overhead)
- Fallback when model metadata is unavailable: `272000` pre-reserve target.
- Budget math is surfaced in run output, debug artifacts, and handoff metadata.

### TODO

- [ ] Add explicit regression coverage for:
  - `400k/128k` class models (preserve legacy ~`272k` input behavior)
  - `272k` class models
  - `1.1M` class models (scale up without near-saturating the window)
- [ ] Decide whether the `75/25` split should remain the default or become configurable per repo/provider
- [ ] Document provider/model differences more explicitly (`openai` vs `openai-codex`, model metadata drift)
- [ ] Watch for real-world context-overflow or answer-truncation regressions and adjust headroom if needed

### Exit criteria

- [ ] No context-overflow regressions in deep-review runs
- [ ] Budget policy stays explainable across provider/model changes
- [ ] Tests cover both legacy `400k/128k` behavior and large-window scaling

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
