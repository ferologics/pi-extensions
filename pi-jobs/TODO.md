# TODO

## Next

- [ ] Run the first real jobs for a week and tune the instructions/notify rules from what they do.
- [ ] Per-run cost guard (max turns or tokens per run) and per-job cost in `/jobs`.

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
- [ ] Keep finished jobs: when a job file is deleted, keep its runs and unread notifications in `/jobs` under a collapsed "Done" section. Today `/jobs` lists only jobs whose files exist, so a job that deletes itself when its work is done (as `session-recap-upstream` did) loses its last notification from the list. Its conversation is still in the state database.
- [ ] Source session for jobs: a job created from a Pi session records it (a `session` frontmatter field with the session file path, set by the agent that writes the job). `/jobs` shows it. `o` on a run continues the source session with the run's result; `O` opens a fresh session seeded with the run, which is what `o` does today. For a job without a source session, `o` behaves like `O`. Today the source session only fits in the job body as text (see `cbh-sdk-logs.md`).
- [ ] Deliver a watch's report into its source session (open question). A live session needs a message channel; writing to its file from outside would conflict with Pi's in-memory state. The Dude's direct messages are that channel, so share it and don't build a second one. A closed session could take an appended entry that waits for it to be reopened. Until then, notifications stay in the `/jobs` inbox, with a link to the source session.
