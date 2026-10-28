# TODO

Status: proposal. The working version lives in the dotfiles. Nothing here is built yet.

Current dotfiles pieces:

- `~/.pi/agent/extensions/session-registry.ts`: Pi side (SIGHUP/129 → restore entry)
- `~/.config/ghostty/bin/pi-session-restore`: helper that claims the entry, types the resume command and prunes entries for closed tabs
- `~/.config/fish/conf.d/pi-session-restore.fish`: shell hook
- `~/.config/fish/functions/pi-session-resume.fish`: resume command that waits for Pi secrets (personal, stays in the dotfiles)

## Decide first

- [ ] Publish it, or keep it in the dotfiles? The dotfiles copy is the source of truth until this is decided.
- [ ] Check alternatives before building: does any Ghostty or Pi feature, Rex/SuperLogical or Tern already cover "resume the Pi session that was in this tab"?
- [ ] Name: `pi-ghostty-restore` (matches `pi-ghostty-hunk` / `pi-ghostty-lazygit`)

## Design questions

- [ ] How the helper gets a stable path. Package install paths differ between git, npm and local packages. Options:
  - the extension writes or refreshes the helper at a fixed path (for example `~/.local/share/pi-ghostty-restore/restore`) on `session_start`
  - the hook asks Pi for the path
  - the hook embeds the JXA itself
- [ ] How the shell hook gets installed:
  - README snippets for fish, zsh and bash
  - or a `/ghostty-restore install` command that writes the hook for the current `$SHELL`
- [ ] Configurable resume command. Default `cd <dir> && pi --session <file>`; an override (env var or Pi setting) lets the dotfiles keep `pi-session-resume`.
- [ ] Quoting for the typed command in fish, zsh and bash (the helper uses POSIX-style `'\''` escaping; confirm it holds in all three)
- [ ] Restore dir: keep `~/.local/state/pi/restore/` or namespace it under the extension name

## Port

- [ ] `index.ts` from `session-registry.ts` (keep the once-per-process `Symbol.for` guard for `/reload`)
- [ ] Helper script shipped in the package
- [ ] Shell hooks for fish, zsh and bash
- [ ] `README.md` that covers:
  - requirements: macOS, Ghostty with AppleScript, `window-save-state = always`
  - the quit-dialog trap: Ghostty's "Review Windows..." is the default and closes every window before quitting, so nothing restores; pick "Terminate Processes"
  - how to wrap the resume command
- [ ] `package.json` + `.github/workflows/npm-publish.yml` like the other `pi-ghostty-*` extensions
- [ ] Add to the `pi.extensions` lists (root and `extensions/package.json`) and to `extensions/TODO.md`

## Verify

Covered in the dotfiles (Oct 2026): Cmd+Q → "Terminate Processes", full macOS restart, cold-secrets reboot (one 1Password prompt for many tabs), cleanup of entries for closed tabs.

- [ ] Ghostty "Restart to Complete Update" path
- [ ] The 60s guard in the closed-tab cleanup during a real relaunch
- [ ] Splits: each split pane gets its own terminal UUID and restores its own Pi
- [ ] zsh and bash hooks
- [ ] Lowest Ghostty version with the AppleScript API the helper uses (`terminals.whose({tty})`, `inputText`, `sendKey`)
- [ ] First-run Automation permission prompt (shell → Ghostty) on a clean machine
- [ ] Shell started outside Ghostty, or with `TERM_PROGRAM` changed (ssh, tmux inside Ghostty): no-op

## Migration (if published)

- [ ] Install the package, delete `~/.pi/agent/extensions/session-registry.ts`, `~/.config/ghostty/bin/pi-session-restore` and the dotfiles hook in the same change (no period where both versions run)
- [ ] Point the resume-command override at `pi-session-resume`
- [ ] Update `~/AGENTS.md` and `~/README.md` in the dotfiles
- [ ] Release through `just release pi-ghostty-restore …` (first version needs the one-time manual npm bootstrap publish)
