# VISION

The Dude is a meta agent for running many Pi sessions in parallel. You talk to him about what is going on across your sessions, what you worked on before, and what to focus on next. Every session you care about can also have a Duck: a paired reviewer that opens as an overlay inside that session.

## Problem

Agents take minutes per task, so work runs in many sessions at once. The bottleneck is your attention: which window is which, which session needs you, what happened last week, what matters most right now. Today you answer those by scanning windows and reading recaps, and you relay second opinions between paired agents by copy-paste.

## Goals

- See every live session in one place, grouped the way you group them (Ghostty windows), with what it is about and whether it needs you, and jump to its terminal in one step.
- Ask one agent questions that span sessions and time: what is running, what happened last week, what to focus on.
- Keep the top-priority work in front of you and him, so easy low-priority work doesn't eat the day.
- Pair a reviewer with a session without opening a second window, and let it send notes into the session directly.
- Keep judgment with you: priorities, direction, review of the parts that matter, and approval of anything that becomes a standing rule.

Where this goes: visibility into all your work (status, progress, usage over hours to months, a TL;DR across everything), control over it, and help managing it. Window management is one small part.

## Surfaces

Two things that other tools also keep apart:

- **The board**: a screen, like Claude Code's agent view. `/dude` in any session opens it as an overlay. It reads published state and session files, makes no model calls, and opens instantly. Peek a session in place, Enter jumps to its terminal.
- **The Dude**: a conversation, like Amp's Puck. You talk to him in his own window, and later from an input line on the board, with the session you are in as "this".

## Primitives

1. **Session state.** Every Pi session runs a small reporter. It publishes the session's project, terminal, status (working, needs you, done but unseen, idle), priority and latest recap, and listens on a socket for messages. It adds no prompt text and no tools beyond sending messages.
2. **Session record.** A short rolling record per session (goal, outcome, decisions, friction, next step) with pointers into the transcript. Each update starts from the previous record plus what changed, so cost follows new work, not session size.
3. **Direct messages.** Send a message to a session by id, labeled with the sender, delivered as a follow-up or a steer.
4. **Duck.** A fresh session on the other model family that reviews one main session. It reads the main transcript as data, not as its own history, stays resumable, and can send notes to the main session.
5. **The Dude.** A directory, not a separate program: his prompt (`AGENTS.md`), his notes (git-tracked) and `.pi/settings.json`, which loads his tools. Conversations with him are ordinary Pi sessions in that directory, so his window is `pi` started there, and Ghostty restore brings it back like any other session. Regular sessions and subagents never load his tools because they never run there.

Rollups, grouping and jumping between windows are built from these.

## Principles

- Every piece has to remove a pain you feel today. Prior art is input, not a dependency.
- Sessions stay the source of truth. Records and notes are derived and can be rebuilt.
- Memory only where it is the agent's job. Work sessions get none. The Dude keeps notes on your priorities, plans and ideas; they change only when you ask or accept a proposed edit, and they are git-tracked. Anything that can be read from live sessions is read, not stored, so notes don't rot.
- Deterministic signals first. Use a model pass only where intent can't be read from session state, and bundle what a session needs (recap, name, record) into one pass instead of several.
- Give agents files and tools, not pasted transcripts. Pi sessions are already files.
- Personas stay thin: a session, a prompt, a few tools and a binding (Duck to one session, The Dude to all of them). No general subagent recursion until something needs it.
- Installable by others. The package carries no personal setup; macOS and Ghostty come first, behind a small seam so other terminals and Linux can follow.

## Not doing

- Memory in work sessions, whether agent-written or injected.
- A wiki or nightly "dreaming" layer over everything.
- Vector search or embeddings, until searching records fails in practice.
- Adopting another harness or runtime (Herdr, pinet, Prime Agent, magic-context).
- Deep subagent trees or RLM-style recursion.
