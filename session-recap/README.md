# session-recap

"While you were away" recap for Pi, modelled on Claude Code's away summary. When you've been away from a Pi session, a short recap is drafted while you're gone and parked at the end of the scrollable transcript, so it's waiting when you return. In Pi's regular TUI it sits above the editor.

Each recap is saved in the session file. Reopening the session shows the saved recap again, including after `pi --session <file>`, `pi -c`, and Ghostty session restore.

Built for multi-Pi workflows where several agent sessions run in parallel tabs. The recap orients rather than reports: it states the high-level task first (what you're building or debugging), then the concrete next step. The last assistant message is already on screen; what you lose after a context switch is the task thread.

Forked from [tmustier/pi-extensions](https://github.com/tmustier/pi-extensions/tree/main/session-recap) at `a360c9c` (session-recap 0.5.2), MIT licensed. This fork adds saved recaps and the recap on CLI reopen.

## How it triggers

1. **Away timer.** The extension enables terminal focus reporting (DECSET `?1004`) on session start. After the terminal has been continuously blurred for `--recap-away-seconds` (default 90s), a recap is generated and shown, so it's parked above the editor when you refocus.
2. **Turn ends while you're away.** If the agent finishes a turn while the terminal is blurred, a recap is drafted after a short debounce.
3. **Idle fallback.** Only on terminals that haven't demonstrated focus-reporting support: `--recap-idle-seconds` (default 120s) after the last `turn_end` with no input, a recap is generated anyway. The first real focus event disarms this path for the session.
4. **Opening an existing session.** `/resume`, `/fork`, `pi --session <file>`, and `pi -c` show the saved recap if the conversation hasn't moved on since it was drafted. Otherwise they draft a new one. Nothing happens when Pi starts with a prompt to work on.

The recap disappears from the screen when you submit a message or new agent work begins. It is never sent to the model.

Quick alt-tabs cost nothing: no model call is made until you've been away for the full threshold. If you return while a recap is still drafting, it finishes and lands moments after you're back.

## Saved recaps

Each recap is appended to the session as a custom entry, which Pi keeps out of the model's context:

```json
{"type":"custom","customType":"session-recap","data":{"text":"…","reason":"focus"},"id":"…","parentId":"…","timestamp":"…"}
```

- `text`: the recap as shown.
- `reason`: what triggered it: `focus` (away timer or a turn ending while away), `idle`, `manual` (`/recap`), or `resume` (opening an existing session).
- `parentId`: the entry the recap was drafted after, like any session entry.

A saved recap is current while it is the latest recap on the active branch and no conversation entry (`message`, `custom_message`, `compaction`, `branch_summary`, `context_edit`) follows it. `findCurrentRecap(branch)` implements that rule.

## Terminal compatibility

| Terminal                                          | Focus reporting  | Notes                                                                                 |
| ------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------- |
| iTerm2, Ghostty, Alacritty, Kitty, WezTerm, xterm | ✅               | Works out of the box.                                                                 |
| VS Code integrated terminal, Warp                 | ✅               | Works.                                                                                |
| Apple Terminal                                    | ⚠️ Partial        | Idle fallback covers it.                                                              |
| tmux                                              | ✅ (with config) | Add `set -g focus-events on` to `~/.tmux.conf`, then `tmux source-file ~/.tmux.conf`. |

If focus events cause any weirdness in your terminal, run with `--recap-disable-focus` and the idle fallback still works.

## Model

The recap reuses the active provider's authentication and chooses a cheaper model when available:

1. `--recap-model` when set.
2. `anthropic/claude-haiku-4-5` for Anthropic sessions.
3. GPT-5.6 Luna when the active model is GPT and its provider offers Luna.
4. The currently active model otherwise.

The recap sends no system prompt, no tools and no Agent Skills, and never writes to the prompt cache. Pi saves its system prompt and tools in the session as `system` messages; the recap leaves those out and sends only the conversation. Anthropic bills a subscription request that carries Pi's prompt as third-party usage. Reasoning is always off: most APIs disable thinking when no reasoning level is requested, and Codex models are sent an explicit `reasoningEffort: "none"` because they would otherwise fall back to the server-side default. Only a cleanly stopped response becomes a recap; a failed stream is reported as an error notification.

It uses a 30-message window from Pi's current projected context, plus the earliest non-omitted user request on the active branch and the latest active compaction or branch summary. Context edits to that request are honoured, including replacement and omission. Large initial requests and tool results retain their beginning and end.

Custom providers work when they use a built-in pi-ai API type. Pi-only custom handlers are skipped because the standalone compatibility layer cannot route them; use `--recap-model "<provider>/<id>"` to select a supported model.

## Flags

| Flag                       | Default   | Description                                                                                          |
| -------------------------- | --------- | ---------------------------------------------------------------------------------------------------- |
| `--recap-away-seconds <n>` | `90`      | Seconds of continuous terminal blur before an away recap is generated.                               |
| `--recap-idle-seconds <n>` | `120`     | Idle-fallback delay after `turn_end`, used only when the terminal doesn't report focus.              |
| `--recap-disable-focus`    | `false`   | Disable DECSET `?1004` focus reporting. Idle fallback still runs.                                    |
| `--recap-during-active`    | `false`   | Allow away recaps while an agent turn is still running, instead of deferring to the end of the turn. |
| `--recap-disable`          | `false`   | Disable automatic recaps, including the saved recap on reopen. `/recap` still works.                 |
| `--recap-model "<p/id>"`   | automatic | Override model selection, e.g. `anthropic/claude-sonnet-4-6`.                                        |

## Command

| Command  | Description                                                    |
| -------- | -------------------------------------------------------------- |
| `/recap` | Force-generate a recap right now, bypassing the activity gate. |

## License

MIT. See [LICENSE](LICENSE) (copyright Thomas Mustier).
