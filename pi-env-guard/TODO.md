# TODO

## Next

- [ ] Explore layer 3, credential masking (see `VISION.md`): agent bash holds a placeholder for an allowed key, and a
      local proxy outside the agent's reach swaps in the real value only on requests to that key's hosts.
  - How Claude Code does it (`sandbox.credentials`, `mode: "mask"`, `injectHosts`, `network.tlsTerminate`), and
    what it needs from the OS sandbox and TLS termination.
  - Which keys fit: HTTP API tokens yes; database URLs (a TCP connection with the password inside) need a different
    shape, such as a local proxy or a short-lived credential.
  - Whether a Pi extension can own the proxy, or it has to sit outside Pi (the agent can read Pi's memory as the
    same user).
- [ ] Ask before deliberate secret reads: a `tool_call` guard for `env`, `printenv`, `launchctl print`/`getenv`,
      `op read`, and known secret files (`.env`, `~/.aws/credentials`, `~/.pi/agent/auth.json`). Stops accidental dumps;
      a determined command still gets around it.

## Release

- [ ] Standalone repo (`ferologics/pi-env-guard`) + `package.json` with `piRelease` + npm publish workflow, then the
      one-time npm bootstrap.
