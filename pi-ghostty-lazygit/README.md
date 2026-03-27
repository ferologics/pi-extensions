# pi-ghostty-lazygit

Open `lazygit` in a new Ghostty window from inside Pi.

## Command

- `/lg` → open `lazygit` at the current repo root in a new Ghostty window

## Behavior

- Uses Ghostty's AppleScript API on macOS
- Opens a new Ghostty window
- Starts at the git repo root for the current Pi cwd
- Launches `lazygit`

## Requirements

- macOS
- Ghostty 1.3.1+ with AppleScript support working
- `lazygit` in `PATH`
- Run the command from inside a git repo

## Install

This extension is bundled in `@ferologics/pi-extensions` / `pi-shit`.

After updating your package, reload Pi:

```bash
/reload
```
