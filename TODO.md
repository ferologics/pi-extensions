# Extensions TODO Index

Use this file as an index (and for truly shared extension-platform chores).

## Extension backlogs

- Deep review: `deep-review/TODO.md`
- Pi Ghostty Hunk: `pi-ghostty-hunk/TODO.md`
- Pi Ghostty Restore (proposal): `pi-ghostty-restore/TODO.md`
- Pi jobs: `pi-jobs/TODO.md`
- Pi system theme: `pi-system-theme/TODO.md`
- Plan mode: `plan-mode/TODO.md`
- Pi verbosity control: `pi-verbosity-control/TODO.md`
- Prompt stash: `prompt-stash/TODO.md`
- The Dude and Duck: `the-dude/TODO.md`

## Proposal: shared live-session layer (undecided)

Status: an idea, not a decision. Collect the consumers first; work below will shape what the layer has to offer.

Several extensions need to see or reach other running Pi sessions, and each builds its own way in:

- the-dude: a record (`~/.local/state/pi/live/<pid>.json`) and a socket (`<pid>.sock`) per interactive session, handling `send` and `priority`. the-dude owns both today.
- `session-registry.ts` in the dotfiles (`pi-ghostty-restore/` proposal): its own Ghostty terminal UUID lookup, the same as the-dude's `ghostty.ts`.
- pi-jobs session watches: delivering a report into a live source session needs a message channel (`pi-jobs/TODO.md`).
- pi-subagent: its own file inbox for parent-to-child messages (upstream package).
- `/reload-global` (parked, below).

Idea: move the record and the socket out of the-dude into a layer any extension can use: handle requests by type, publish its own fields, list sessions, send or broadcast requests. the-dude becomes one consumer.

Still to come that will inform it: the-dude slice 2 (The Dude's tools to list, read, focus and message sessions) and pi-jobs watch delivery.

Open questions:

- [ ] A separate extension, a library that extensions import, or both
- [ ] How extensions reach it: a process-wide object (`Symbol.for`; survives `/reload`, no load-order dependency) or `pi.events` (Pi's documented channel, but fire-and-forget: no replies, and registrations depend on load order)
- [ ] Which fields are core (pid, session, cwd, label, terminal id) and which belong to a consumer (status, priority, recap)
- [ ] Whether pi-ghostty-restore and pi-jobs watches wait for it, or ship first and move onto it later

Parked:

- [ ] `/reload-global`: `/reload` in every live session at once. Built and tested inside the-dude, then shelved until the layer is decided. What it needs:
  - Only a command context can reload, so a receiving session dispatches its own command with `pi.sendUserMessage("/<command>", { expandPromptTemplates: true })`. The handler runs even mid-run; it calls `ctx.waitForIdle()`, then `ctx.reload()`, so no run is cut off.
  - The initiating session reports from the runtime the reload creates: the old ctx is stale, the chat is rebuilt, and an info notify collapses into Pi's own "Reloaded …" status line.
  - Sessions running code without the request answer `unknown request`, so the first rollout needs one manual `/reload` each.

## Ownership rules

- Put extension-specific TODOs next to the extension folder.
- Keep this file short and pointer-oriented.
- Keep upstream source-of-truth aligned in `~/dev/pi-extensions` when working there.
