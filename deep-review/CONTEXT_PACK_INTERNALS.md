# Deep Review Context Pack Internals

This is the maintainer-facing documentation for how `/deep-review` context packing works, why key decisions were made, and where we want to go next.

Use this as the living doc.

- Historical implementation plan: `extensions/deep-review/CONTEXT_PACK_REWRITE_PLAN.md`
- Active backlog: `extensions/deep-review/TODO.md`

---

## 1) Product goals

The context pack stage should be:

1. Deterministic (same repo state + options => same outputs)
2. Auditable (explicit omission reasons)
3. Practical for large repos (runtime and token-budget aware)
4. Safe for review quality (avoid dropping mission-critical context silently)

---

## 2) Current architecture (stable)

### Pipeline

1. Resolve repo/base commits and gather changed files + diff
2. Build changed-file blocks (after filters)
3. Query Scribe for related/dependent candidates
4. Merge + rank candidates deterministically
5. Estimate candidate token cost
6. Budget-fit related files and render final pack
7. Emit manifests + report JSON

### Output artifacts

- `pr-context.txt`
- `pr-context.changed.files.txt`
- `pr-context.related.files.txt`
- `pr-context.omitted.files.txt`
- `pr-context.related.omitted.files.txt`
- `pr-context.related.selection.tsv`
- `pr-context.scribe.targets.tsv`
- `pr-context.report.json`

### Deterministic ordering tuple

Related candidates are sorted by:

1. `relationWeight` (desc)
2. `frequency` (desc)
3. `distance` (asc)
4. `estimatedTokens` (asc)
5. `path` (asc)

---

## 3) Key decisions made so far

1. **Direct context-pack execution in extension**
   - Removed nested `pi -p --skill` path
   - Reduced fragility from parsing nested stdout

2. **Modern Scribe invocation only**
   - Pinned `@sibyllinesoft/scribe@1.0.4` via `npx`
   - Avoids incompatibility with Cargo `scribe-cli`

3. **Explicit omission reporting**
   - Related omissions use explicit reasons
   - `already-in-changed-files` overlap noise removed from related omission stats/manifests

4. **Headroom reservation for deep-review request payload**
   - Effective context-pack budget is reduced from requested budget
   - Helps avoid API-side `context_length_exceeded` despite local token fit

---

## 4) Known bottlenecks (high priority)

Observed slow runs (~minutes) are likely dominated by:

1. **Scribe fan-out cost**
   - Many changed targets can trigger many Scribe runs

2. **Per-candidate token counting**
   - Current approach estimates tokens candidate-by-candidate via subprocess calls

3. **Repeated pack render + token recount loops**
   - Necessary for correctness, but expensive on large packs

---

## 5) Experiment notes (important context)

### Experiment: broad forced local test inclusion from diff-affected directories

Intent:

- Prevent high-value local tests from being dropped by budget pressure

Outcome:

- Solved some local test omissions
- But caused substantial displacement of runtime/helper files in some runs
- Increased complexity and runtime
- Risk of overfitting behavior to one repo’s structure

Current stance:

- Treat this as a **useful but not yet final** direction
- Do not assume broad forced-test policy is universally correct
- Prefer configurable policy (repo-level overrides) over hardcoded repo-specific assumptions

---

## 6) Direction (short term)

### A. Speed first

- Batch token estimation (single/fewer `tokencount` runs)
- Add stage timing telemetry in report (`git/scribe/filter/tokenize/render`)
- Keep deterministic output while introducing bounded concurrency where safe

### B. Keep default policy generic

- Avoid hardcoding repo-specific bundles in extension defaults
- Prefer additive repo-level rules for project-specific priorities

### C. Safer quality controls for budget edge cases

- Explore interactive omission arbitration as fallback
- Optionally allow advisory scoring pass (non-authoritative) for tie-breaks

---

## 7) Candidate config model (future)

Potential repo-level policy file (name TBD), for example:

- `.pi/context-pack.rules.yaml`

Use cases:

- Priority include globs
- Per-repo must-include sets
- Include/exclude policies for tests/helpers/docs
- Budget shares by category (optional)

This should be optional and layered on top of sane defaults.

---

## 8) Guardrails for future changes

Before changing selection policy:

1. Validate on more than one repo shape
2. Compare `selection.tsv` deltas (what newly included/excluded)
3. Track impact on runtime and omission profile
4. Keep behavior auditable in artifacts

If a rule improves one repo but degrades others, make it opt-in/configurable.
