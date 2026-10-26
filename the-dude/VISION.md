# VISION

The Dude is a meta agent for running many Pi sessions in parallel. You talk to him about what is going on across your sessions, what you worked on before, and what to focus on next. Every session you care about can also have a Duck: a paired reviewer that opens as an overlay inside that session.

## Problem

Agents take minutes per task, so work runs in many sessions at once. The bottleneck is your attention: which window is which, which session needs you, what happened last week, what matters most right now. Today you answer those by scanning windows and reading recaps, and you relay second opinions between paired agents by copy-paste.

## Goals

- See every live session in one place, grouped by project, with what it is about and whether it needs you, and jump to its window in one step.
- Ask one agent questions that span sessions and time: what is running, what happened last week, what to focus on.
- Pair a reviewer with a session without opening a second window, and let it send notes into the session directly.
- Keep judgment with you: priorities, direction, review of the parts that matter, and approval of anything that becomes a standing rule.

## Primitives

1. **Session state.** Each Pi session publishes its project, terminal, status (working, needs me, done but unseen, idle) and latest recap.
2. **Session record.** A short rolling record per session (goal, outcome, decisions, friction, next step) with pointers into the transcript. Each update starts from the previous record plus what changed, so cost follows new work, not session size.
3. **Direct messages.** Send a message to a session by id, labeled with the sender, delivered as a follow-up or a steer.
4. **Duck.** A fresh session on the other model family that reviews one main session. It reads the main transcript as data, not as its own history, stays resumable, and can send notes to the main session.
5. **The Dude.** A mode, not a separate program: an extension activated by a flag that adds his tools, his prompt and the tower view, and keeps his own notes.

Rollups, grouping and jumping between windows are built from these.

## Principles

- Every piece has to remove a pain you feel today. Prior art is input, not a dependency.
- Sessions stay the source of truth. Records and notes are derived and can be rebuilt.
- Memory only where it is the agent's job. Work sessions get none. The Dude keeps notes on your priorities, plans and ideas; they change only when you ask or accept a proposed edit, and they are git-tracked.
- Give agents files and tools, not pasted transcripts. Pi sessions are already files.
- Personas stay thin: a session, a prompt, a few tools and a binding (Duck to one session, The Dude to all of them). No general subagent recursion until something needs it.
- macOS and Ghostty first. The window layer sits behind a small seam so Linux can follow.

## Not doing

- Memory in work sessions, whether agent-written or injected.
- A wiki or nightly "dreaming" layer over everything.
- Vector search or embeddings, until searching records fails in practice.
- Adopting another harness or runtime (Herdr, pinet, Prime Agent, magic-context).
- Deep subagent trees or RLM-style recursion.
