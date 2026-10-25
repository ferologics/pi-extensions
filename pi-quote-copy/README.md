# pi-quote-copy

Copy a quoted (`>`) or fenced (`` ``` ``) block from the last response as raw Markdown. Useful for prompts, handoffs, and templates that the agent writes for you to paste somewhere else.

## Usage

| Trigger        | Behavior                                                           |
| -------------- | ------------------------------------------------------------------ |
| `/quote`       | Copy a block from the last response                                |
| `Ctrl+Shift+X` | Same as `/quote` (Pi's built-in `Ctrl+X` copies the whole message) |

- "Last response" means every assistant message since your last prompt.
- One block: copied immediately.
- Several blocks: pick one from a list (newest first, with kind, line count, and first line).
- Quotes are copied without their `>` markers; fenced blocks without their fences. Blocks nested in list items count; a fenced block inside a quote stays part of the quote.
