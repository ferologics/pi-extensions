# Deep Review Extension

Run a 2-phase deep PR review flow inside your current Pi session:

1. Context packing via nested `pi -p` + `/skill:pr-context-packer`
2. Direct OpenAI Responses API streaming (thinking + final answer)

## Setup

```bash
# 1) OpenAI auth
export OPENAI_API_KEY=your_key_here

# 2) Required by bundled pr-context-packer
cargo install tokencount

# 3) Install/update package
pi install npm:pi-shit
```

Then in Pi:

```text
/deep-review "review the code"
```

Typical runtime is ~6–20 minutes, depending on repo size and model latency.

### Recommended extras

- `gh` (GitHub CLI): auto-includes PR title/body in the context pack.
- `scribe` (or `npx @sibyllinesoft/scribe`): richer related-file expansion in the context pack.

## Commands

- `/deep-review <query> [options]`
- `/deep-review-stop`

## Defaults

- Model: `gpt-5.2`
- Reasoning effort: `xhigh`
- Summary: `auto` (shows readable reasoning summary deltas)
- Verbosity: `medium`
- Base ref: auto-detected by `pr-context-packer`

## Options

- `--query <text>` (alternative to positional query; cannot be combined with positional query text)
- `--project <path>`
- `--base <ref>`
- `--model <id>`
- `--effort minimal|low|medium|high|xhigh`
- `--verbosity low|medium|high`
- `--summary auto|detailed|null`
- `--no-summary` (shortcut for `--summary null`)
- `--org <id>`
- `--project-id <id>`
- `--debug`
- `--help`

## Example

```text
/deep-review "find bugs and regressions"
```

## Notes

- The context-pack subprocess is launched with explicit skill scope:
  - `--no-skills --skill <bundled skills/pr-context-packer/SKILL.md>`
- `deep-review` fails fast if that bundled skill file is missing.
- Intended package layout is `pi-shit` (`extensions/` + `skills/` in one package).
- Scribe expansion stays enabled in context-packer (no disable flag in this extension).
- Use `--no-summary` if you want parity mode without readable reasoning summary text.
- The command updates Pi UI live with a compact status widget (phase + stream progress).
- Streamed thinking/answer text is not previewed live in the widget; full markdown answer is posted at completion.
- Context-pack stage output is posted into the current session.
- Final response includes duration, token usage, and estimated cost.
- Final answer/thinking/report are written to a temp output folder and linked in the result.
- The extension attempts to copy the final answer to clipboard automatically.
