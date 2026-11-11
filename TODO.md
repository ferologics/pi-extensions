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
- [ ] Which session operations the layer carries beyond messages: abort, reload (`/reload-global` below), maybe any operation Pi exposes to extensions, so other sessions and Tank can control a session, not only message it

Parked:

- [ ] `/reload-global`: `/reload` in every live session at once. Built and tested inside tank, then shelved until the layer is decided. What it needs:
  - Only a command context can reload, so a receiving session dispatches its own command with `pi.sendUserMessage("/<command>", { expandPromptTemplates: true })`. The handler runs even mid-run; it calls `ctx.waitForIdle()`, then `ctx.reload()`, so no run is cut off.
  - The initiating session reports from the runtime the reload creates: the old ctx is stale, the chat is rebuilt, and an info notify collapses into Pi's own "Reloaded …" status line.
  - Sessions running code without the request answer `unknown request`, so the first rollout needs one manual `/reload` each.

## Move from Ghostty to Rex (in progress)

Status: moving now. Rex (Superlogical's terminal on libghostty, macOS app in beta) replaces our Ghostty-specific code; the concepts carry over, only the window layer changes. The `send_to_session` socket stays: Rex can only type into programs.

Checked on Nov 2 against a throwaway server (Rex 0.0.1793299046, Pi 1.4.0):

- The Rex server owns sessions and programs, so quitting the app leaves Pi running. A server stop or reboot ends every program. On restart Rex brings back sessions, tabs, labels, cwds and block ids, but each block starts a fresh shell: commands are not replayed and the scrollback was gone.
- Pi reports OSC 7501 program status (working, blocked, done, error, idle) when the terminal supports it; Rex shows it in the sidebar and tabs.
- Every Rex terminal gets `REX_SESSION`, `REX_BLOCK`, `REX_SERVER`, `REX_BIN_DIR` and `TERM_PROGRAM=rex`, and loses the `GHOSTTY_*` variables.
- `rex server stop` ignores `REX_SERVER` and stops the app's server, ending every session.

Checked on Nov 11 in Rex.app 0.1.0 (build 1925):

- Shift+Enter, Hyper+T and the other keys reach Pi; Pi's `system` theme follows Rex's palette; focus reports work (done (unseen) shows and clears on focus).
- pi-notify's OSC 777 notification showed up next to Rex's own Program Activity notification for the same run.
- The app update left the running server (with sessions) on the old version until it is restarted.
- Rex's Integrations setting installs `~/.agents/skills/rex`, a stub that tells every agent to follow `rex __internal skill`, plus Claude Code and Codex hooks. Kept off.
- Session restore end to end on a throwaway server: Pi in a block, server SIGTERM, restart, Pi resumes in the same block; an entry left by a closed tab is pruned.

Done:

- [x] Session restore (dotfiles): entries keyed on `$REX_BLOCK`, resumed by a fish hook at the shell's first prompt; no AppleScript, no typing.
- [x] tank: Rex window layer (`tank/rex.ts`); tabs titled with priority and label.
- [x] `pi-rex-split`: `/hunk` and `/lg` in a pane to the right of Pi.
- [x] pi-jobs `o`: new tab in the current Rex session.
- [x] pi-notify sends nothing in Rex.
- [x] Dotfiles: `just rex settings-macos` (font, left Option as Alt, copy on select, Remote Control), Hyper+R → Rex. Themes stay Rex's own.

Left:

- [ ] Check in the app, after "Restart Server…" puts the server on the app's version: tab titles in the sidebar, Enter on the board and `tank_focus`, `/hunk`, `/lg`, jobs `o`.
- [ ] Move the live Ghostty sessions: one Rex session per Ghostty window, one tab per Pi session, each resumed with `pi-session-resume`; quit each Pi in Ghostty first.
- [ ] Cutover: disable `pi-ghostty-hunk` and `pi-ghostty-lazygit` in `~/.pi/agent/settings.json` (they register the same commands), delete the Ghostty restore pieces and retire `pi-ghostty-restore/`, drop Hyper+G, update the dotfiles docs.
- [ ] Tank's Rex session first in the sidebar (by hand, once); the rest you order by hand.

## Ownership rules

- Put extension-specific TODOs next to the extension folder.
- Keep this file short and pointer-oriented.
- Keep upstream source-of-truth aligned in `~/dev/pi-extensions` when working there.
