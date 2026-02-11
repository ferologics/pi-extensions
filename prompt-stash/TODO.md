# TODO — prompt-stash extension

## Problem to solve

Keep "prompt ideas for later" inside the project (not clipboard/scratchpad), and make them easy to revisit in new Pi sessions.

---

## Agreed direction so far

- [x] Build a Pi extension (not a skill).
- [x] Use project-local storage under `.pi/`.
- [x] Store one prompt per file.
- [x] Prefer command names `/pstash` + `/prompt-stash` (avoid `/stash` git confusion).
- [x] Core interaction should be hotkey-driven (not command-heavy).
- [x] Do **not** auto-load a prompt into the editor on session start.
- [x] Automatic "used" detection is important (avoid manual mark-as-used workflow).

---

## Storage candidates

### Option A (current favorite)

```
.pi/prompt-stash/
  pending/
  used/
  state.json
```

- `pending/`: stash inbox
- `used/`: consumed/archive prompts (for history + undo)
- `state.json`: selected item, last loaded item, optional metadata

### Naming alternatives

- `pending/used` (clear + conventional)
- `stashed/applied`

Keep this open for now.

---

## UI / interaction ideas captured

### 1) Prompt-editor integrated flow (preferred UX)

- Show stash hint near editor (e.g. right-side status like `pstash [2/7]`).
- Hotkeys to cycle prompt selection.
- Light/gray preview above editor (or in status/widget) for selected item.
- Separate hotkey to load selected prompt into editor.

Notes:

- This likely needs `setEditorComponent(...)` + custom editor rendering.
- Need to evaluate compatibility with other editor-overriding extensions (e.g. prompt-editor from MitsuPi package).

### 2) Lightweight extension menu flow (fallback)

- Open a custom UI picker (`ctx.ui.custom`/`ctx.ui.select`) from one hotkey.
- User cycles/selects and presses Enter to load.
- Fewer editor internals, possibly more robust.

### 3) Command-first flow (least preferred)

- `/pstash list|next|prev|load|send`
- Kept as fallback/admin surface, but not ideal for primary UX.

---

## "Used" detection strategies discussed

### A) Consume on load

- Move pending -> used as soon as prompt is loaded into editor.
- Simple, but too aggressive if user changes mind.

### B) Consume on next submit after load

- Track last loaded prompt; next user message marks it used.
- Low friction, but can misfire if next message is unrelated.

### C) Consume on submit with similarity check

- After load, compare submitted message with loaded stash text.
- Mark used only if match/overlap threshold passes.
- More accurate, but adds complexity and edge cases.

### D) Explicit send path (always consume)

- `/pstash send` or hotkey-invoked send for selected prompt.
- Guaranteed consume when used.

Current thinking:

- Keep **explicit send** path.
- Add one automatic strategy (B or C) after validating UX.

---

## Open questions for next session

- [ ] Final directory names: `pending/used` vs `stashed/applied`.
- [ ] Should selected index persist across restarts (`state.json`)?
- [ ] Which hotkeys are default for:
  - [ ] cycle previous
  - [ ] cycle next
  - [ ] load selected into editor
  - [ ] send selected directly
- [ ] Should preview show full prompt or truncated first lines?
- [ ] For automatic consume, choose B (simple) vs C (match-based).
- [ ] If custom editor is used, how do we avoid conflicts with other editor extensions?
- [ ] Should there be an "undo last consume" action?

---

## Implementation phases (proposal)

### Phase 1 — reliable core

- [ ] File storage + metadata helpers
- [ ] Add/import stash entries (text + multiline)
- [ ] Basic status indicator for pending count
- [ ] Picker/menu load flow
- [ ] Explicit send path + consume

### Phase 2 — editor-native UX

- [ ] Editor badge/status (`pstash [i/n]`)
- [ ] Hotkey cycling without opening menu
- [ ] Inline/gray preview
- [ ] Automatic consume strategy (B or C)

### Phase 3 — polish

- [ ] Undo consume
- [ ] Better matching heuristics (if C chosen)
- [ ] docs + examples + troubleshooting
