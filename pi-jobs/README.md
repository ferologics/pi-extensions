# pi-jobs

Scheduled agent jobs for Pi. A small daemon runs each job on a cron schedule as a [Pi Durable](https://earendil.com/posts/pi-durable/) conversation; the Pi extension shows the jobs, their results, and an inbox of notifications.

Jobs run whether or not a Pi session is open. Each job keeps one conversation across runs, so a run can compare against earlier ones ("only notify when something changed").

## How it works

- **Definitions:** one markdown file per job in `~/.config/pi-jobs/jobs/<name>.md`. The daemon rereads them every 30 seconds.
- **Daemon** (`daemon/`): a Node process kept alive by launchd. It opens a Pi Durable harness on `~/.local/state/pi-jobs/jobs.sqlite`, uses Pi's logins from `~/.pi/agent/auth.json`, and serves an HTTP API on `127.0.0.1:4747`.
- **Scheduling:** every 30 seconds the daemon computes each job's latest cron slot from the wall clock and submits it once, keyed `<job>@<slot>`. Pi Durable's `requestId` makes the submission exactly-once, so a crash or restart never runs a slot twice. Slots missed while the Mac slept or the daemon was down collapse into the latest one. A new job waits for its first slot.
- **Crash recovery:** every model turn and tool call is checkpointed. A daemon killed mid-run continues that run on restart.
- **Tools in job runs:** `web_search` (Exa, Brave, Claude, Codex; shared with [`pi-web`](../pi-web/)), `web_fetch`, and `notify` (desktop notification plus inbox item), or the subset a job lists in `tools`. A job with a `command` also gets `job_command`, which runs that command and returns its exit status and output.
- **Pi extension** (`index.ts`): `/jobs` overlay, `jobs_list` / `jobs_run` / `jobs_results` tools, and a footer status when the inbox has new items.

## Job definition

```markdown
---
schedule: "0 */6 * * *" # 5-field cron, local time (required)
model: anthropic/claude-sonnet-5-5 # provider/modelId (default shown)
thinking: low # off | minimal | low | medium | high | xhigh (optional)
enabled: true # optional, default true
tools: web_fetch, notify # optional; default web_search, web_fetch, notify
---

Watch for a new Pi release.

Check https://github.com/earendil-works/pi/releases with web_fetch and find the latest release.
Notify with the version and its headline changes when it is newer than the one the last run saw. Do not notify when nothing changed.
```

The body is the job's standing task. Say exactly when to call `notify`; every run ends with a short summary that shows up in `/jobs` and `jobs_results`. Changing a definition reconfigures the job's conversation before its next run.

### Command jobs

```markdown
---
schedule: "0 10 * * 1"
command: /usr/bin/python3 ~/bin/audit.py --days 8
tools: notify
---

Triage the audit report. Notify about real findings that earlier runs have not reported.
```

`command` gives the job a `job_command` tool, and its instructions tell each run to call it first. The model cannot pass arguments: the tool runs exactly the configured command through `/bin/sh -c` from the home directory, with a 10 minute timeout, and returns the exit status, stdout, and stderr (long output is cut to Pi's tool output limit; the full text goes to a temp file). It is not replay-safe, so a daemon crash mid-command reports the call as interrupted instead of running it again. The daemon runs under launchd, so `PATH` is the launchd default (`/usr/bin:/bin:/usr/sbin:/sbin`); use absolute paths for anything else.

A command whose output contains untrusted text (scraped pages, logs, agent transcripts) can carry prompt injection into the run. Give such jobs `tools: notify`, so the worst a hostile output can do is a misleading notification, not a web request that leaks the output.

## Install

```bash
just install    # npm ci in daemon/, render the launchd plist, start the agent
just status     # launchd state + /api/health
just logs       # follow ~/Library/Logs/pi-jobs.log
just restart    # pick up daemon code changes
just uninstall  # stop and remove the agent (keeps jobs and state)
```

`just dev` runs the daemon in the foreground instead. Environment overrides: `PI_JOBS_DIR`, `PI_JOBS_STATE_DIR`, `PI_JOBS_AUTH`, `PI_JOBS_HOST`, `PI_JOBS_PORT`. The extension reads `PI_JOBS_URL` (default `http://127.0.0.1:4747`).

### Secrets

`EXA_API_KEY` and `BRAVE_API_KEY` come from the daemon's environment, then from `launchctl getenv`, which the Pi secrets bootstrap in fish fills. After a reboot, Exa and Brave searches fail until a shell has warmed that cache; `web_fetch` and the Claude/Codex search providers only need Pi's logins.

## HTTP API

| Method | Path                  | Returns                                        |
| ------ | --------------------- | ---------------------------------------------- |
| GET    | `/api/health`         | `{ ok, pid }`                                  |
| GET    | `/api/jobs`           | Jobs with last run and next run, invalid files |
| GET    | `/api/jobs/:name`     | One job with its prompt and recent runs        |
| POST   | `/api/jobs/:name/run` | Starts a manual run                            |
| GET    | `/api/inbox`          | Notifications, newest first                    |
| POST   | `/api/inbox/read`     | Marks every inbox item read                    |

## Status

Experimental. Pi Durable's API changes without notice, so the daemon pins `@earendil-works/pi-durable` and its siblings to the exact Pi version they were built against.
