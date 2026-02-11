# TODO

## Near-term priorities (updated)

Reference: `extensions/deep-review/CONTEXT_PACK_INTERNALS.md`

### P0 — Runtime / performance

- [ ] Batch token estimation for related candidates (avoid one `tokencount` subprocess per file)
- [ ] Add stage timing telemetry in report JSON (`git`, `scribe`, `filter`, `tokenize`, `render`)
- [ ] Reduce redundant render/tokenize loops where possible without losing deterministic guarantees
- [ ] Explore bounded Scribe concurrency with deterministic post-sort merge

### P1 — Selection policy quality

- [ ] Re-evaluate broad forced local-test inclusion (observed to improve some misses but displace runtime files)
- [ ] Define a generic default policy that does not overfit a single repo shape
- [ ] Add optional repo-level override mechanism (for example `.pi/context-pack.rules.yaml`) for project-specific priorities
- [ ] Add integration tests that assert mission-critical local code is not unexpectedly dropped in budget-tight runs

### P2 — UX controls for boundary cases

- [ ] Explore optional interactive omission arbitration loop (user chooses what to keep/drop under budget pressure)
- [ ] Explore optional advisory scoring pass (non-authoritative) for difficult tie-breaks

---

## Direct context-pack pipeline rewrite (replace nested `pi -p` skill path)

Goal: move context packing fully into `extensions/deep-review` TypeScript code (no nested Pi session, no skill indirection), with deterministic selection and explicit omission reporting.

Reference plan: `extensions/deep-review/CONTEXT_PACK_REWRITE_PLAN.md`

### Phase 1 — Foundations

- [x] Create `extensions/deep-review/context-pack/` module scaffold:
  - `types.ts`
  - `git.ts`
  - `filters.ts`
  - `scribe.ts`
  - `rank.ts`
  - `budget.ts`
  - `render.ts`
  - `artifacts.ts`
  - `index.ts`
- [x] Define typed result contract returned to `deep-review` command handler.
- [x] Define `report.json` schema (versioned, stable keys for scripts/tests).

### Phase 2 — Git + core context assembly

- [x] Resolve repo root + base ref in TS (`--base` override + autodetect fallback).
- [x] Collect changed files + name-status + diff in TS (parity with current output).
- [x] Reuse/port safety filters and omission reason mapping from script.
- [x] Build changed-file full-content blocks deterministically.

### Phase 3 — Scribe recall integration (unbounded defaults)

- [x] Call Scribe directly from TS for each eligible changed-file target.
- [x] Default to unbounded recall behavior:
  - no `--max-depth`
  - no `--max-files`
  - no target-limit cap
  - include dependents
- [x] Parse Scribe XML paths + stats (`limits_reached`, distances, reasons, etc.).
- [x] Emit target-level audit manifest (`*.scribe.targets.tsv`) from structured data.

### Phase 4 — Deterministic ranking + budget fit

- [x] Build related candidate universe from Scribe outputs (deduped, deterministic).
- [x] Rank candidates deterministically (stable tuple; no semantic model pass in this phase).
- [x] Render baseline pack (no related) and token-count it.
- [x] If baseline exceeds budget, fail with explicit `core-over-budget` diagnostics.
- [x] Greedily include related files within remaining budget.
- [x] Final token check + deterministic tail-trim loop until fit.
- [x] Record all omitted related files with explicit reason (`over-budget`, filtered, overlap, etc.).

### Phase 5 — Deep-review integration

- [x] Replace nested `pi -p --skill` context-pack stage with direct TS packer call.
- [x] Keep `--context-pack <path>` fast path (skip generation) intact.
- [x] Update context-pack stage UI message to use typed metrics (not stdout parsing).
- [x] Preserve existing handoff artifacts and markdown report format.

### Phase 6 — Hard cutover + cleanup

- [x] Add/expand unit tests (filters, ranking, budget-fit, report schema).
- [ ] Add integration tests for:
  - no Scribe available
  - Scribe failure on subset of targets
  - large related set with deterministic trimming
  - baseline/core over budget
- [x] Cut over directly to TS context-packer path (no engine flag).
- [x] Delete nested `pi -p --skill` context-pack path and dead helpers in the same change.
- [x] Update `extensions/deep-review/README.md` with new architecture + behavior.

### Exit criteria

- [x] `/deep-review` context packing no longer depends on nested Pi skill execution.
- [x] Context-pack result path/metadata comes from typed TS return object only.
- [x] Omitted files are always listed with explicit reasons.
- [ ] Deterministic runs produce stable selection/manifests for identical input.
- [ ] Existing deep-review response streaming/output behavior remains intact.

### Future explore (parked)

- [ ] Interactive omitted-file picker for budget arbitration (post-TS rewrite).
- [ ] Add context-pack cache/reuse by repo + branch + base/head commit fingerprint:
  - Auto-reuse latest matching pack when available.
  - Allow override with explicit `--context-pack <path>`.
  - Skip rebuild for repeated/concurrent reviews on same branch state.

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
