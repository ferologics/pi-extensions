# TODO

## Near-term

- [ ] Live with the simple `/hunk` launcher for a while and note any obvious friction before expanding scope.
- [ ] Decide whether optional launch variants like `hunk diff --watch` or `hunk diff --staged` actually earn dedicated UX.

## Future Pi ↔ Hunk bridge

- [ ] Pair/discover the active Hunk session for the current repo via `hunk session list --json`.
- [ ] Support prompt-driven annotation of review findings into the active Hunk session.
- [ ] Support prompt-driven reading/summarizing of Hunk comments back into Pi.
- [ ] Keep transport glue in the extension, but prefer skills/templates/plain prompting over command soup.

## Wait for upstream Hunk UX

- [ ] Revisit native user-authored inline comments once Hunk supports them well.
- [ ] Revisit richer reply/thread flows if Hunk grows a stronger conversation model.

## Packaging / release

- [ ] Keep this bundled in `@ferologics/pi-extensions` / `pi-shit` unless it clearly earns a standalone package.
