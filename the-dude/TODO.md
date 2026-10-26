# TODO

Backlog for The Dude and Duck. Duck items move to `extensions/duck/TODO.md` once that extension exists.

## Done

- [x] session-recap fork: recap on CLI reopen and saved recaps (`extensions/session-recap/`, until upstream #121 lands).

## Next: first slice

- [ ] Session state: every Pi publishes project, terminal id, status and latest recap. Decide whether this grows `~/.pi/agent/extensions/session-registry.ts` (Ghostty restore) or moves into pi-shit.
- [ ] Messaging: our own, one mechanism every agent uses. Start from agent-stuff's `control.ts` (per-session Unix socket, steer or follow-up; last touched May 2026) and fork or rewrite it. Consider making session state and messaging one base extension: each session publishes its state and listens on its socket.
- [ ] Define the statuses: working; needs me; done but unseen (finished while its terminal was unfocused, cleared on focus); idle.
- [ ] Tower view: fullscreen grid grouped by project with status and recap; peek a session in place; Enter focuses its Ghostty terminal (AppleScript `focus`).
- [ ] Hyper+1–9 to jump to sessions (skhd calls a focus helper).

## The Dude

- [ ] Extension activated by a flag, plus a fish function to start it.
- [ ] Prompt and tools: list sessions, read a session or its record, focus a window, message a session.
- [ ] Notes: our own, shaped like pi-mem: a long-term notes file, a scratchpad, a daily log, topic notes read on demand. Load a snapshot at session start and don't change the system prompt mid-session (keeps the prompt cache). Every write is a small git commit, so history and rollback come free. Edits happen when you ask or when you accept his proposal (Prime Agent's `/refine`, without the automation).
- [ ] Semantic grouping: an LLM pass over records, rerun when sessions start, end or update their record.
- [ ] Papercuts: capture a friction note in the moment; review them with The Dude.

## Duck

- [ ] `/duck` opens an overlay in the main session: a fresh session on the other model family, persistent and resumable, with the main transcript as data.
- [ ] Send notes into the main session.
- [ ] Find out how much of the normal session UI an overlay can host. `/btw` (agent-stuff) shows a side session with its own small UI works; check history navigation, tree and `/new`.
- [ ] Speaks only when asked at first; decide later whether it should flag things unprompted.

## Records

- [ ] Rolling record updated at recap time from the previous record plus new entries, saved in the session.
- [ ] Decide the model, and whether the update reuses the main session's warm prompt cache.

## Later

- [ ] Daily and weekly rollups. Decide pi-jobs or a dedicated mechanism once records exist.
- [ ] Overnight papercut fixes: small, high-confidence changes that land as diffs for review.
- [ ] The Dude talking to Ducks instead of main sessions.
- [ ] Linux window layer; remote sessions.
- [ ] Move pi-subagent's parent-to-child messaging onto the shared mechanism (fork or upstream change), so subagents, Ducks and The Dude all use one.

## Open questions

- Name for the tower view.
- Which messaging tools work sessions get, if any. Receiving needs only the socket.
