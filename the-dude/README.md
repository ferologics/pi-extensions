# the-dude

One board for every Pi session you have open. Each interactive Pi session publishes what it is doing; `/dude` in any session shows them all, grouped the way you group them (Ghostty windows), with what each one is about and whether it needs you. Enter jumps to the session's terminal.

This is the first slice of The Dude, a meta agent for running many sessions in parallel. See [VISION.md](VISION.md) and [TODO.md](TODO.md) for where it goes.

## The board

`/dude` opens a fullscreen overlay:

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

Priority is saved in the session itself (a `the-dude-priority` custom entry), so it survives `/resume` and Ghostty restore.

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

- `{"type":"send","message":"…","mode":"follow_up"|"steer","from":{"sessionId","label","project"}}` shows the message in the session, labeled with the sender. An idle session starts a run on it; a busy one queues it as a follow-up (default) or a steer.
- `{"type":"priority","priority":0|1|2|3|null}` sets the priority, as `p` on the board does.

Replies are `{"ok":true,"data":…}` or `{"ok":false,"error":"…"}`.

Every session has one tool for it, `send_to_session`: target a session by id or label; an unknown or ambiguous target returns the live sessions. After 3 messages in a row with no input from you, further messages are shown but neither start nor continue a run, so two sessions can't keep each other busy.

## Requirements

- Grouping by window and Enter need Ghostty on macOS (AppleScript). Elsewhere the board groups by project and Enter only works for the session it was opened in.
- When a session can't look up its Ghostty terminal, it shows a warning and `/reload` tries again. When the board can't read Ghostty's windows, its title says why and it groups by project meanwhile.
- Focus reports need a terminal that sends them. In tmux, `set -g focus-events on`.
