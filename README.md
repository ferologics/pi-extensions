# pi-extensions

Custom extensions for [pi-coding-agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent).

## Extensions

| Extension                                       | Description                                                                        |
| ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| [`deep-review`](deep-review/)                   | Run context-pack + direct OpenAI Codex/Platform deep review with live streaming UI |
| [`pi-ghostty-hunk`](pi-ghostty-hunk/)           | Open Hunk in a new Ghostty window at the current repo root                         |
| [`pi-ghostty-lazygit`](pi-ghostty-lazygit/)     | Open lazygit in a new Ghostty window at the current repo root                      |
| [`pi-notify`](pi-notify/)                       | Desktop notifications when the agent finishes                                      |
| [`pi-slack-user`](pi-slack-user/)               | Read Slack permalinks and post confirmed replies with a user OAuth token           |
| [`pi-system-theme`](pi-system-theme/)           | Sync Pi theme with macOS dark/light mode and configurable theme names              |
| [`plan-mode`](plan-mode/)                       | Read-only plan mode with progress tracking and questionnaire support               |
| [`pi-verbosity-control`](pi-verbosity-control/) | Per-model OpenAI verbosity overrides with a keyboard toggle                        |

Each extension folder contains full usage details and examples.

## Install as a Pi package

```bash
pi install git:github.com/ferologics/pi-extensions
```

## Development

Install Pi globally, then run `npm ci` and `just check` from this directory.
TypeScript and Vitest use the installed Pi at `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent`.
Local npm installs skip host-provided peer dependencies; update Pi to check compatibility with a new release.

## Setup

Symlink extensions to `~/.pi/agent/extensions/`:

```bash
ln -s ~/dev/pi-extensions/deep-review ~/.pi/agent/extensions/
ln -s ~/dev/pi-extensions/pi-ghostty-hunk ~/.pi/agent/extensions/
ln -s ~/dev/pi-extensions/pi-ghostty-lazygit ~/.pi/agent/extensions/
ln -s ~/dev/pi-extensions/pi-notify ~/.pi/agent/extensions/
ln -s ~/dev/pi-extensions/pi-system-theme ~/.pi/agent/extensions/
ln -s ~/dev/pi-extensions/plan-mode ~/.pi/agent/extensions/
ln -s ~/dev/pi-extensions/pi-verbosity-control ~/.pi/agent/extensions/
```
