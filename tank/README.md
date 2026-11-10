# tank

One board for every Pi session you have open. Each interactive Pi session publishes what it is doing; `/tank` in any session shows them all, grouped the way you group them (Ghostty windows), with what each one is about and whether it needs you. Enter jumps to the session's terminal.

It also gives you Tank, one persistent meta agent who sees all of those sessions: you talk to him about what is going on across your work and what to focus on next. See [VISION.md](VISION.md) and [TODO.md](TODO.md) for where it goes.

## The board

`/tank` or Hyper+T opens a fullscreen overlay, also while you are typing a message; Hyper+T closes it again. Hyper+T is `ctrl+shift+alt+super+t` (Caps Lock as Hyper), which needs a terminal that reports `super` through the Kitty keyboard protocol, like Ghostty.

- One group per Ghostty window, sessions in tab order. The header lists the window's projects and its best priority. Windows with a p0 session come first.
- Sessions outside Ghostty (tmux, other terminals) are grouped by project after the windows.
- Each card shows the status and how long the session has had it, the project, the label (the session's `/name`, else the first line of its first prompt), why it needs you, and the latest recap.

| Key         | What it does                                                                   |
| ----------- | ------------------------------------------------------------------------------ |
| `←↑↓→`      | Select a card (`hjkl` too)                                                     |
| `space`     | Peek: the session's last two prompts with replies and tool calls, kept current |
| `enter`     | Focus the session's Ghostty terminal and close the board                       |
| `p` `0`–`3` | Set the session's priority (`p` `-` clears it)                                 |
| `esc`       | Close the peek, or the board                                                   |

Priority is saved in the session itself (a `tank-priority` custom entry), so it survives `/resume` and Ghostty restore.

## Statuses

| Status        | When                                                                                                                                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| working       | A run is active.                                                                                                                                                                                           |
| needs you     | A tool opened a blocking dialog (confirm, select, input), or the run failed. A failure stays until you type. Dialogs you open yourself (`/jobs`, `/btw`) don't count unless a tool is running at the time. |
| done (unseen) | The run finished while the terminal was unfocused. Clears when you focus the terminal or type.                                                                                                             |
| idle          | Everything else.                                                                                                                                                                                           |

Focus comes from terminal focus reports (DECSET 1004). Before the first report, a session counts as focused. Status starts over at `/reload`.

## What each session publishes

Every interactive session (not print/RPC mode, not pi-subagent children) writes `~/.local/state/pi/live/<pid>.json` (`$XDG_STATE_HOME/pi/live` when set) and removes it on exit. Entries of processes that died without cleaning up are deleted by the next reader.

```json
{
    "v": 1,
    "pid": 4242,
    "sessionId": "…",
    "sessionFile": "~/.pi/agent/sessions/….jsonl",
    "cwd": "/Users/you/dev/app",
    "project": { "key": "github.com/you/app", "name": "app" },
    "label": "fix the flaky login test",
    "terminalId": "0DF93B4C-…",
    "status": "needs-you",
    "statusSince": "…",
    "statusDetail": "failed: Connection error.",
    "priority": 0,
    "recap": { "text": "…", "at": "…" },
    "model": "anthropic/claude-opus-5-5",
    "startedAt": "…",
    "updatedAt": "…"
}
```

- `project.key` is the repo's remote URL without scheme, user and `.git`, so every clone of a repo shares it. Repos without a remote use their git common dir (shared by worktrees), anything else its cwd.
- `terminalId` is Ghostty's AppleScript terminal id (the surface UUID it keeps across restarts).
- `recap` is the latest `session-recap` custom entry, written by [tmustier's session-recap](https://github.com/tmustier/pi-extensions/tree/main/session-recap) when it is installed.

## Messages between sessions

Each session also listens on `~/.local/state/pi/live/<pid>.sock` (only your user can open it) for newline-delimited JSON:

- `{"type":"send","message":"…","mode":"follow_up"|"steer","from":{"sessionId","label","project"}}` delivers the message as a user message that starts with `[Message from another Pi session (project …, session …)]`. An idle session starts a run on it. A busy one queues it as a follow-up (default) or a steer in Pi's own queue: it shows above the editor while it waits, and an abort puts it back into the editor like a message you typed.
- `{"type":"priority","priority":0|1|2|3|null}` sets the priority, as `p` on the board does.

Replies are `{"ok":true,"data":…}` or `{"ok":false,"error":"…"}`.

Every session has one tool for it, `send_to_session`: target a session by id or label; an unknown or ambiguous target returns the live sessions. After 3 messages in a row with no input from you, further messages are shown but neither start nor continue a run, so two sessions can't keep each other busy.

## Tank

Tank is a Pi session started in his home: a directory with the marker `.pi/tank.json`. Sessions anywhere else stay ordinary sessions and never get his tools.

Set up his home once from the starter in this package, as its own git repo:

```bash
cp -R <this package>/extensions/tank/home ~/dev/tank
cd ~/dev/tank && git init && git add -A && git commit -m "Tank's home"
pi
```

- `AGENTS.md` is his prompt: what he is and what he has. Change it as you like.
- `NOTES.md` is in his prompt on every turn as `<notes>`: Directives, Priorities and Follow-ups as dated bullets, replaced in place, under 4000 characters. Topic notes go in `topics/<name>.md`, which he reads when needed.
- `.pi/tank.json` marks the home. `{ "notes": false }` turns his notes off: no notes section, no `tank_notes`.

His tools, besides `send_to_session`:

| Tool            | What it does                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------------- |
| `tank_sessions` | Every live session by Ghostty window and tab: id, project, label, status, priority, recap, file |
| `tank_read`     | The end of a session's transcript; older history is in its session file                         |
| `tank_priority` | Set a session's priority (p0–p3) or clear it                                                    |
| `tank_focus`    | Bring a session's terminal to the front                                                         |
| `tank_notes`    | Replace `NOTES.md` or a topic note; each edit is one git commit                                 |

A changed notes section reaches his prompt as a patch. On models that take mid-conversation system messages (Opus 5.5 and GPT-6 in Pi's catalog) the cached prompt survives it; on others Pi rebuilds the prompt.

## Requirements

- Grouping by window and Enter need Ghostty on macOS (AppleScript). Elsewhere the board groups by project and Enter only works for the session it was opened in.
- When a session can't look up its Ghostty terminal, it shows a warning and `/reload` tries again. When the board can't read Ghostty's windows, its title says why and it groups by project meanwhile.
- Focus reports need a terminal that sends them. In tmux, `set -g focus-events on`.
