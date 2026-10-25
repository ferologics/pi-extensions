# TODO

## Next

- [ ] Run the first real jobs for a week and tune the instructions/notify rules from what they do.
- [ ] Per-run cost guard (max turns or tokens per run) and per-job cost in `/jobs`.
- [ ] Inbox like Codex's Scheduled view: runs that notified or failed show as unread; quiet runs stay in the job's history.

## Standalone repo

- [ ] Add a standalone `package.json` + `piRelease` + npm publish workflow (release targets require both), and bootstrap the npm package.

## Remote

- [ ] Multi-machine ownership: a job must never run on more than one machine, and the always-on machine should win. Job files are shared through dotfiles, so a second `just install` today means every job runs twice. A single configured owner host is a stopgap; the real fix is coordination (for example a lease with heartbeat in shared state, or one scheduler service other daemons defer to).
- [ ] systemd unit for the home box; bind the API to the tailscale address.
- [ ] `pi-env` remote execution for jobs that need the Mac.
- [ ] Phone notifications when the daemon is not on the Mac (ntfy or Slack DM).
- [ ] Web page served by the daemon for viewing jobs and results.

## Command jobs (low priority; pi-jobs is agent-first)

- [ ] Script-first gate: run `command` before the model and skip the model when the output is unchanged since the last run.
- [ ] Script-only jobs (no model, notify on failure or changed output), only if it stays cheap; standalone scripts can stay in plain launchd.

## Session watches

- [ ] In-session background commands and watches (deploys, CI) that die with the session and report back into it.
