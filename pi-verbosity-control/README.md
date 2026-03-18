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
- Monkeypatches Pi's built-in footer so verbosity appears inline with the model/thinking display instead of on a separate status line
- Cycles the current model's verbosity with a shortcut and saves it back to the config file

Exact `provider/model` entries win over bare model ids.

## Supported APIs

- `openai-responses`
- `openai-codex-responses`
- `azure-openai-responses`

## Shortcut

- macOS: `Alt+V`
- Other platforms: `Ctrl+Alt+V`

The shortcut cycles:

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
    "models": {
        "gpt-5.4": "low",
        "openai/gpt-5.4": "medium"
    }
}
```

If you edit the file manually while Pi is already running, use `/reload`.

## Notes

- The footer integration is a runtime monkeypatch of Pi's built-in `FooterComponent`, not a public footer-composition API.
