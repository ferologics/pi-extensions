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
- [ ] An abort drops queued session messages. Pi's abort clears the agent's queues and returns only what you typed to the editor, so a `send_to_session` message queued as a follow-up or steer vanishes, while its sender was already told "queued as a follow-up". Keep it (for example appended without starting a run) and tell the sender.
- [ ] Show queued session messages: nothing shows a message waiting as a follow-up or steer. Show `✉ 1 queued from <sender>` above the editor until it is delivered.
- [ ] Labels from prompts that start with an attached file read `<file name="…">`, because the label is the first line of the first prompt. Skip `<file>` blocks. (A `/name` already wins.)

## Slice 2: Tank

- [ ] His directory: `AGENTS.md`, notes, `.pi/settings.json` loading his extension. The package ships a starter directory.
- [ ] Tools: list sessions and windows, read a session, focus a terminal, message a session, set priority.
- [ ] Talk to him from the board: an input line, with the session you are in as "this". Find out how much of a session an overlay can host (`/btw` runs a side session with its own small UI).
- [ ] Notes: our own, shaped like pi-mem: a long-term notes file, a scratchpad, a daily log, topic notes read on demand. Load a snapshot at session start and don't change the system prompt mid-session (keeps the prompt cache). Every write is a small git commit, so history and rollback come free. Edits happen when you ask or when you accept his proposal (Prime Agent's `/refine`, without the automation).
- [ ] Notes don't rot: hold only what can't be read from sessions (priorities, plans, decisions); on load, check them against live sessions and propose deletions.
- [ ] Regroup windows on request: propose a grouping from paths, labels and recaps; apply it by resuming each moved session in a new tab of the target window, then closing the old tab (Ghostty's AppleScript can't move tabs between windows). Idle sessions only.
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
- [ ] Rex window layer in place of Ghostty: see "Later: move from Ghostty to Rex" in `../TODO.md`.
- [ ] Move pi-subagent's parent-to-child messaging onto the shared mechanism (fork or upstream change), so subagents, Ducks and Tank all use one. See the shared live-session layer proposal in `../TODO.md`.
