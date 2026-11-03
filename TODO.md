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
- Tank and Duck: `tank/TODO.md`

## Proposal: shared live-session layer (undecided)

Status: an idea, not a decision. Collect the consumers first; work below will shape what the layer has to offer.

Several extensions need to see or reach other running Pi sessions, and each builds its own way in:

- tank: a record (`~/.local/state/pi/live/<pid>.json`) and a socket (`<pid>.sock`) per interactive session, handling `send` and `priority`. tank owns both today.
- `session-registry.ts` in the dotfiles (`pi-ghostty-restore/` proposal): its own Ghostty terminal UUID lookup, the same as tank's `ghostty.ts`.
- pi-jobs session watches: delivering a report into a live source session needs a message channel (`pi-jobs/TODO.md`).
- pi-subagent: its own file inbox for parent-to-child messages (upstream package).
- `/reload-global` (parked, below).

Idea: move the record and the socket out of tank into a layer any extension can use: handle requests by type, publish its own fields, list sessions, send or broadcast requests. tank becomes one consumer.

Still to come that will inform it: tank slice 2 (Tank's tools to list, read, focus and message sessions) and pi-jobs watch delivery.

Open questions:

- [ ] A separate extension, a library that extensions import, or both
- [ ] How extensions reach it: a process-wide object (`Symbol.for`; survives `/reload`, no load-order dependency) or `pi.events` (Pi's documented channel, but fire-and-forget: no replies, and registrations depend on load order)
- [ ] Which fields are core (pid, session, cwd, label, terminal id) and which belong to a consumer (status, priority, recap)
- [ ] Whether pi-ghostty-restore and pi-jobs watches wait for it, or ship first and move onto it later

Parked:

- [ ] `/reload-global`: `/reload` in every live session at once. Built and tested inside tank, then shelved until the layer is decided. What it needs:
  - Only a command context can reload, so a receiving session dispatches its own command with `pi.sendUserMessage("/<command>", { expandPromptTemplates: true })`. The handler runs even mid-run; it calls `ctx.waitForIdle()`, then `ctx.reload()`, so no run is cut off.
  - The initiating session reports from the runtime the reload creates: the old ctx is stale, the chat is rebuilt, and an info notify collapses into Pi's own "Reloaded …" status line.
  - Sessions running code without the request answer `unknown request`, so the first rollout needs one manual `/reload` each.

## Later: move from Ghostty to Rex

Status: parked, transition later. Rex (Superlogical's terminal multiplexer on libghostty, macOS app in beta) would replace most of our Ghostty-specific code. The concepts carry over; only the window layer changes.

Checked in November 2026 (Rex 0.0.1793299046, Pi 1.4.0):

- The Rex server owns sessions and programs, so quitting the app leaves Pi running. A server stop or reboot ends every program. On restart Rex brings back sessions, tabs, labels, cwds and block ids, but each block starts a fresh shell: commands are not replayed and the scrollback was gone.
- Pi already reports OSC 7501 program status (working, blocked, done, error, idle) when the terminal supports it. Rex shows it in its session picker and tab headers, and `rex block call … program_status` reads it.
- Every Rex terminal gets `REX_SESSION`, `REX_BLOCK`, `REX_SERVER` and `TERM_PROGRAM=rex`, and loses the `GHOSTTY_*` variables, so our Ghostty paths switch off cleanly.
- The `rex` CLI, Lua scripts (`rex do`), events and the self-describing API (`rex api list`) cover everything we do with AppleScript.
- `rex server stop` ignores `REX_SERVER` and stops the app's server, ending every session.
- `rex skill setup` writes `~/.agents/skills/rex`, which Pi reads. Its text comes from the `rex` binary, so it changes with every Rex update, outside our reviewed-bump rule.

What moves:

- [ ] Session restore (dotfiles pieces and `pi-ghostty-restore/`): only reboots remain. Key restore entries on `$REX_BLOCK`; no AppleScript, no typing into the terminal.
- [ ] tank: terminal id from `REX_BLOCK`, groups from Rex sessions (`session.view`), Enter through the app's `session.select` action (needs Remote Control in Rex settings), statuses from Pi's OSC 7501. The `send_to_session` socket stays.
- [ ] pi-ghostty-hunk, pi-ghostty-lazygit, pi-jobs `o`: `rex run` / `rex window new` instead of AppleScript.
- [ ] Dotfiles: skhd Hyper+G to bundle id `com.superlogical.rex`; Ghostty config (font, Rose Pine, option-as-alt, the Ctrl+E/Ctrl+K raw keys, copy-on-select) into Rex settings and `~/.config/rex/init.lua`.

Untested, check before switching: Shift+Enter and the Kitty keyboard protocol, Pi's `system` theme reading Rex's palette, focus reports (DECSET 1004), OSC 777 notifications, whether a Rex update restarts a server with running sessions.

## Ownership rules

- Put extension-specific TODOs next to the extension folder.
- Keep this file short and pointer-oriented.
- Keep upstream source-of-truth aligned in `~/dev/pi-extensions` when working there.
