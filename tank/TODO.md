# TODO

Backlog for Tank and Duck. Duck items move to `extensions/duck/TODO.md` once that extension exists.

## Done

- [x] Saved recaps: tmustier's session-recap saves each recap as a `session-recap` custom entry (`{ text, model }`) and shows it again on reopen. The reporter reads the latest one.

## Slice 1: reporter and board

Done when you can open the board and see your real sessions with correct statuses.

- [x] Reporter in every interactive session (not pi-subagent children): `~/.local/state/pi/live/<pid>.json` with session id and file, cwd, project, label, Ghostty terminal id, status, priority and latest recap. Removed on exit; readers skip dead pids.
- [x] Statuses, deterministic:
  - working: a run is active (`agent_start` until `agent_settled`)
  - needs you: a blocking dialog opened during a run (`ui_prompt_start`), or the run failed
  - done but unseen: the run finished while the terminal was unfocused (DECSET 1004), cleared on focus or input
  - idle: everything else
- [x] Project identity: origin remote URL (clones group together), else the git common dir (worktrees), else the cwd.
- [x] Socket per session (`<pid>.sock`): messages and priority changes from the board.
- [x] `send_to_session` tool in every session: target by session id or label, follow-up or steer, labeled with the sender.
- [x] `/tank` board overlay in any session: grouped by Ghostty window, windows sorted by priority; cards with status, project, label and recap; space peeks the transcript tail, Enter focuses the terminal, `p` sets p0–p3 (saved in the session, survives restore).
- [x] Check on your real sessions in Ghostty: window grouping and Enter confirmed by you; done (unseen) cards seen on the real board.
- [x] Hyper+T shows and hides the board from anywhere in Pi, also mid-message (Pi shortcut; skhd leaves the key alone).
- [x] Queued session messages go through Pi's own queue (they are sent as user messages): shown above the editor while they wait, and put back into the editor on abort.
- [x] Labels skip files attached with @: the first line of your own text, else the first file's name. (A `/name` wins.)

## Slice 2: Tank

- [x] His home: a directory with `AGENTS.md`, `NOTES.md` and the marker `.pi/tank.json`; a Pi session started there is Tank. The package ships a starter (`home/`); yours is `~/dev/tank`.
- [x] Tools: `tank_sessions` (by window and tab), `tank_read` (transcript tail), `tank_priority`, `tank_focus`; `send_to_session` for messages.
- [x] Notes: `NOTES.md` (Directives, Priorities, Follow-ups; dated, replaced in place, under 4000 characters) as a prompt section, `topics/*.md` read when needed, no daily log. `tank_notes` is the only write path: you accept the diff, one git commit. `"notes": false` in `.pi/tank.json` turns them off.
- [ ] Hyper+A: Tank's window from any app; starts him (`pi -c` in his home) when he isn't running; pressed again in Tank, back to where you were.
- [ ] Regroup windows on request: he proposes a grouping from paths, labels and recaps, you approve the whole plan once, and he applies it by resuming each moved session in a new tab of the target window, then closing the old tab (Ghostty's AppleScript can't move tabs between windows). Idle sessions only; needs a `quit` request on the session socket.
- [ ] Research notes: Tank with notes on and off; whether they rot; cache reads on a real notes edit. Per Pi's model catalog, Opus 5.5 and GPT-6 take mid-conversation system messages, so an edited notes section goes out as a patch and the cached prompt stays; Haiku 4.5 rebuilds the prompt. Not measured yet.
- [ ] Subagents Tank starts run in his home, so they become Tank too: his tools, including `tank_notes`. Decide whether they should. If not, they stay ordinary sessions, the way subagents already stay off the board.
- [ ] Papercuts: capture a friction note in the moment; review them with Tank.

## Duck

- [ ] `/duck` opens an overlay in the main session: a fresh session on the other model family, persistent and resumable, with the main transcript as data.
- [ ] Send notes into the main session.
- [ ] Find out how much of the normal session UI an overlay can host. `/btw` (agent-stuff) shows a side session with its own small UI works; check history navigation, tree and `/new`.
- [ ] Speaks only when asked at first; decide later whether it should flag things unprompted.

## Records

- [ ] Rolling record updated at recap time from the previous record plus new entries, saved in the session.
- [ ] Decide the model, and whether the update reuses the main session's warm prompt cache.

## Stretch

Where the ideal is ahead of what we build now.

- [ ] One digest pass per session that produces the recap, an auto name, the record, and whether a finished session is done for good or waiting on your input, instead of separate calls on the same data. Share a warm cache between such passes where it pays.
- [ ] Auto session names that describe the session, kept current as it drifts; tab titles show them (tab-status could use the session name).
- [ ] Priority inference: time you spend focused in each session (the reporter already sees focus), plus what Tank knows of your plans.
- [ ] Grouping rule: Tank proposes a grouping, you correct it, he keeps the rule he used and applies it next time.
- [ ] Move tabs between windows natively, if Ghostty's AppleScript gains it.
- [ ] Board: token usage over hours, days, weeks and months; a TL;DR across all sessions with where to focus next; progress per session.
- [ ] Summon Tank from outside Ghostty.

## Later

- [ ] Daily and weekly rollups. Decide pi-jobs or a dedicated mechanism once records exist.
- [ ] Overnight papercut fixes: small, high-confidence changes that land as diffs for review.
- [ ] Tank talking to Ducks instead of main sessions.
- [ ] Linux window layer; remote sessions.
- [ ] One Tank across machines: find a running one and connect to it, or start a local one; keep his notes and artifacts in sync (a git remote for his home is the first step).
- [ ] Rex window layer in place of Ghostty: see "Later: move from Ghostty to Rex" in `../TODO.md`.
- [ ] Move pi-subagent's parent-to-child messaging onto the shared mechanism (fork or upstream change), so subagents, Ducks and Tank all use one. See the shared live-session layer proposal in `../TODO.md`.
