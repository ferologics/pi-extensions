# pi-rex-split

Open Hunk or lazygit in a [Rex](https://www.superlogical.com/rex) pane to the right of Pi.

## Commands

- `/hunk` → `hunk diff` at the repo root
- `/lg` → `lazygit` at the repo root

## Behavior

- Splits this Pi's pane and puts the tool on the right, focused. The pane closes when the tool exits.
- Run again while the tab still has that pane, the command focuses it instead of opening another.
- After a Rex server restart the pane comes back as a plain shell; the command closes it and opens the tool fresh.
- Calls the `rex` CLI of the server this Pi runs under (`$REX_BIN_DIR`) with `--autostart=false`, so it never starts a server.

## Requirements

- Pi running in a Rex terminal
- `hunk` / `lazygit` on your login shell's `PATH`
- Run the command from inside a git repo
