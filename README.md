# pi-extensions

Custom extensions for [pi-coding-agent](https://github.com/badlogic/pi-mono).

## Extensions

| Extension                             | Description                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------- |
| [`deep-review`](deep-review/)         | Run context-pack + direct OpenAI Responses deep review with live streaming UI |
| [`pi-notify`](pi-notify/)             | Desktop notifications when the agent finishes                                 |
| [`pi-system-theme`](pi-system-theme/) | Sync Pi theme with macOS dark/light mode and configurable theme names         |
| [`plan-mode`](plan-mode/)             | Read-only plan mode with progress tracking and questionnaire support          |

Each extension folder contains full usage details and examples.

## Install as a Pi package

```bash
pi install git:github.com/ferologics/pi-extensions
```

## Setup

Symlink extensions to `~/.pi/agent/extensions/`:

```bash
ln -s ~/dev/pi-extensions/deep-review ~/.pi/agent/extensions/
ln -s ~/dev/pi-extensions/pi-notify ~/.pi/agent/extensions/
ln -s ~/dev/pi-extensions/pi-system-theme ~/.pi/agent/extensions/
ln -s ~/dev/pi-extensions/plan-mode ~/.pi/agent/extensions/
```
