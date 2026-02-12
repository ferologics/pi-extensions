# pi-system-theme

A Pi extension that syncs Pi's theme with macOS appearance (dark/light mode).

## Behavior

- macOS dark mode -> `darkTheme`
- macOS light mode -> `lightTheme`
- Detection uses:

```bash
/usr/bin/defaults read -g AppleInterfaceStyle
```

If detection fails or returns an unknown value, the extension keeps the current Pi theme unchanged.

## Defaults (works out of the box)

No config is required.

- `darkTheme`: `dark`
- `lightTheme`: `light`
- `pollMs`: `2000`

## Configuration file (global only)

Path:

- `~/.pi/agent/system-theme.json`

The extension stores only **overrides** in this file. If all values match defaults, the file is removed.

Example:

```json
{
    "darkTheme": "rose-pine",
    "lightTheme": "rose-pine-dawn"
}
```

## Interactive command

Use `/system-theme` to open a small settings menu and edit:

1. dark theme name
2. light theme name
3. poll interval (ms)

Choose **Save and apply** to persist overrides and apply immediately.

## Notes

- This extension currently only acts on macOS (`process.platform === "darwin"`).
- In headless modes without theme support (for example `-p` print mode), the extension stays idle.
- If a configured theme name does not exist, Pi keeps the current theme and logs a warning.

## Install

From npm (standalone package):

```bash
pi install npm:pi-system-theme
```

From git:

```bash
pi install git:github.com/ferologics/pi-system-theme
```

Or from local source while developing:

```bash
pi -e /path/to/pi-system-theme/index.ts
```
