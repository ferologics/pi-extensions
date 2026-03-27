# Vision

`pi-ghostty-hunk` should stay simple.

Its job is to make Hunk feel connected to Pi without turning the extension into a giant review framework.

## What this extension is

- A small Ghostty launcher for Hunk from inside Pi
- A future home for lightweight Pi ↔ Hunk transport glue
- Part of a human-first review workflow where the user actually reads code in Hunk

## What this extension is not

- An attempt to reimplement Hunk inside Pi
- A command-heavy review system with lots of bespoke slash commands
- A giant workflow engine that tries to own every review step

## Desired workflow

- Open Hunk from Pi
- Read and understand the code directly in Hunk
- Use Pi normally to ask for help, summarize, review, or annotate findings
- Let Pi project useful anchored notes into Hunk when asked
- Let Pi read Hunk state back when that becomes useful and ergonomic

## Design principles

- Keep the extension thin
- Prefer prompt/skill/template-driven flows over hardcoded command surfaces
- Add extension behavior only when it provides real transport or session glue that prompting alone cannot provide cleanly
- Keep human review primary; agent assistance should support it, not replace it
- Avoid premature architecture and only grow features after real usage pain shows up

## Future direction

If Hunk grows strong native support for user-authored inline comments and richer interaction, this extension can become the Pi-side bridge for that workflow.

Until then, the right default is a minimal launcher plus carefully chosen integration points.
