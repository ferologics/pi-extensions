# pi-extensions

Custom extensions for [pi-coding-agent](https://github.com/badlogic/pi-mono).

## Extensions

| Extension | Description |
| --- | --- |
| [`deep-review`](deep-review/) | Run context-pack + direct OpenAI Responses deep review with live streaming UI |
| [`pi-notify`](pi-notify/) | Desktop notifications when the agent finishes |
| [`plan-mode`](plan-mode/) | Read-only plan mode with progress tracking and questionnaire support |

Each extension folder contains full usage details and examples.

## Setup

Symlink extensions to `~/.pi/agent/extensions/`:

```bash
ln -s ~/dev/pi-extensions/deep-review ~/.pi/agent/extensions/
ln -s ~/dev/pi-extensions/pi-notify ~/.pi/agent/extensions/
ln -s ~/dev/pi-extensions/plan-mode ~/.pi/agent/extensions/
```
