# VISION

pi-jobs is the one place for recurring agent work: website and news watches, release and dependency checks, nightly or weekly digests. The kind of thing ChatGPT's scheduled tasks or hand-rolled launchd scripts do today.

## Goals

- Jobs outlive Pi sessions and the machine they were written on: a daemon owns them, Pi is one client.
- Each job runs each slot exactly once through Pi Durable, and carries what it knows from run to run in a handoff summary.
- pi-jobs owns only what is about jobs (`notify`, `job_command`). Every other tool comes from the package that owns it, through its Pi Durable adapter (pi-web's `web_search` and `web_fetch`).
- One definition format (a markdown file per job) that a person or an agent can write.
- Notify only when something needs attention; everything else stays readable in the job's history.

## Direction

- v0 runs on the Mac under launchd with local tools.
- Next: run the same daemon on an always-on home box (systemd, tailscale), reach the Mac through `pi-env` for jobs that need it, and add a small web page for viewing jobs from any device.
- Jobs come in two kinds. Standing jobs recur and have no home session. Session watches are jobs an agent creates from a session to wait for something, act on it, and report back. A watch outlives the Pi process, so it runs in the daemon like any job, but it belongs to its source session: it records that session, and its results lead back to it.
- Watches that should die with their session (tailing a deploy or a CI run) stay an in-session concern, outside pi-jobs.
- A finished or deleted job keeps its history and notifications.
- Keep it small: no job pools, no plugin system, no second scheduler language beyond cron.
