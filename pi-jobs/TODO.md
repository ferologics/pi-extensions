# TODO

## Next

- [ ] Run the first real jobs for a week and tune the instructions/notify rules from what they do.
- [ ] Per-run cost guard (max turns or tokens per run) and per-job cost in `/jobs`.
- [ ] Keep job conversations bounded: compaction works, but consider `reset()` with a handoff note after N runs.
- [ ] Shell jobs: a job that runs a command (for example `lpse.py scan`) and has the agent summarize or notify on its output.

## Standalone repo

- [ ] The daemon imports pi-web's search/fetch modules by relative path; the standalone mirror (`ferologics/pi-jobs`) needs them vendored or published before it runs on its own.
- [ ] Then add a standalone `package.json` + `piRelease` + npm publish workflow (release targets require both), and bootstrap the npm package.

## Remote

- [ ] systemd unit for the home box; bind the API to the tailscale address.
- [ ] `pi-env` remote execution for jobs that need the Mac.
- [ ] Phone notifications when the daemon is not on the Mac (ntfy or Slack DM).
- [ ] Web page served by the daemon for viewing jobs and results.

## Session watches

- [ ] In-session background commands and watches (deploys, CI) that die with the session and report back into it.
