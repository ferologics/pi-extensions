# Vision

`pi-ghostty-restore` should make Ghostty restarts safe for Pi users who have many Pi sessions open.

Quitting Ghostty, accepting a Ghostty update, or rebooting macOS should bring every tab back with the same Pi session open in the same directory. Nobody should have to avoid restarts to keep their sessions.

## What this extension is

- A Pi extension that, when Ghostty goes away underneath Pi, records which session was open in which Ghostty terminal
- A small macOS helper that types the resume command into the matching terminal after Ghostty restores it
- A one-line shell hook that runs that helper when a restored shell starts

## What this extension is not

- A layout or window manager: Ghostty's `window-save-state = always` restores windows, tabs, splits, sizes and working directories
- A session server that keeps Pi processes running across restarts (the tmux/Rex model): Pi exits and is started again on the same session file
- A snapshot tool that scrapes Ghostty state before quitting: there is no reliable quit hook, and Ghostty already saves its state
- A cross-terminal or cross-platform abstraction

## How it works

- Ghostty restores each terminal with the same surface UUID, which is the `id` in Ghostty's AppleScript API.
- On `session_start`, the extension looks up its terminal UUID once and remembers the cwd and session file.
- When Ghostty goes away by any route, Pi gets SIGHUP (or exits with 129 because its terminal is gone). Only then does the extension write `<restore dir>/<terminal UUID>.json`.
- A normal Pi exit (`/quit`, Ctrl+D) or a crash writes nothing, so sessions you ended on purpose stay ended.
- In a restored shell, the hook runs the helper. The helper claims this terminal's entry atomically and types the resume command into the terminal.
- Closing a tab also sends SIGHUP, which leaves an entry whose terminal never comes back. The helper deletes entries for terminals Ghostty doesn't have, but only after Ghostty has been running for 60s, so it never races a restore that is still opening windows.

## Design principles

- Ghostty owns the layout and Pi owns the sessions; this extension only links a terminal to a session.
- Write state only when a restore is wanted. No polling, no background jobs, no timers.
- Keep the user's shell in charge of starting Pi. The resume command can be configured, so setups that need something first (secrets, env, wrappers) can wrap it.
- Never start Pi in a state the user didn't ask for. If the resume command fails, it stays in shell history for a manual retry.
- Keep it small enough to read in one sitting and delete in one step.

## Boundaries

- macOS plus Ghostty with its AppleScript API, and `window-save-state = always`
- One extra step outside Pi: a Pi package can't install a shell hook, and after a restart nothing Pi-related is running until a shell starts it

## Future direction

If Ghostty or Pi gains native "resume what was running in this surface" support, this extension should shrink to nothing.
