# pi-verbosity-control

Apply per-model OpenAI `text.verbosity` overrides and cycle the current model's setting from the keyboard.

## Install

```bash
pi install npm:pi-verbosity-control
```

Or via git:

```bash
pi install git:github.com/ferologics/pi-verbosity-control
```

Restart Pi or use `/reload` if you are developing locally.

## What it does

- Reads global config from `~/.pi/agent/verbosity.json`
- Supports model-specific overrides by bare model id (`gpt-5.4`) or exact provider/model (`openai-codex/gpt-5.4`)
- Applies `text.verbosity` to supported OpenAI Responses-family requests right before they are sent
- Cycles the current model's verbosity with a shortcut and saves it back to the config file
- Optionally shows the active verbosity inline in Pi's footer

Exact `provider/model` entries win over bare model ids.

## Supported APIs

- `openai-responses`
- `openai-codex-responses`
- `azure-openai-responses`

## Anthropic / Claude

This extension is intentionally OpenAI-only.

Anthropic does not currently expose a direct equivalent to OpenAI `text.verbosity`. Claude's `output_config.effort` is a separate effort/thoroughness control, not a drop-in verbosity setting, so this extension does not map verbosity onto Anthropic models.

## Shortcuts

- Cycle verbosity
  - macOS: `Alt+V`
  - Other platforms: `Ctrl+Alt+V`
- Toggle footer indicator
  - macOS: `Alt+Shift+V`
  - Other platforms: `Ctrl+Alt+Shift+V`

The verbosity cycle is:

```text
low -> medium -> high -> low
```

## Config

Path:

```text
~/.pi/agent/verbosity.json
```

Example:

```json
{
    "showIndicator": false,
    "models": {
        "gpt-5.4": "low",
        "openai/gpt-5.4": "medium"
    }
}
```

- `showIndicator` defaults to `false`
- When `showIndicator` is `false`, the extension does not patch Pi's footer at all

If you edit the file manually while Pi is already running, use `/reload`.

## Notes

- The optional footer indicator uses a runtime monkeypatch of Pi's built-in `FooterComponent`, not a public footer-composition API.
