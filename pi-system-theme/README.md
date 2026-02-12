# pi-system-theme

A Pi extension that syncs Pi's theme with system appearance (dark/light mode) on macOS and Linux.

## Behavior

- Dark appearance -> `darkTheme`
- Light appearance -> `lightTheme`

Detection backends:

```bash
# macOS
/usr/bin/defaults read -g AppleInterfaceStyle

# Linux (GNOME-compatible)
gsettings get org.gnome.desktop.interface color-scheme
# fallback: gsettings get org.gnome.desktop.interface gtk-theme
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

- This extension acts on macOS and Linux (`process.platform === "darwin" || process.platform === "linux"`).
- Linux support currently depends on GNOME-compatible `gsettings` keys (`color-scheme`, with `gtk-theme` fallback).
- In headless modes without theme support (for example `-p` print mode), the extension stays idle.
- If your current theme is custom and `darkTheme`/`lightTheme` are still default (`dark`/`light`), the extension does nothing to avoid overriding your setup. Configure `/system-theme` to opt into syncing.
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
