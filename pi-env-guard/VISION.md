# VISION

Pi-native secret hygiene for what the agent runs: the agent's commands see only the secrets they are meant to use, and
a secret the agent does use is worthless outside the place it is meant for.

## Three layers

From "How to Keep API Keys Away From Your AI Coding Agent" (developersdigest.tech, updated 2026-10-09,
https://www.developersdigest.tech/blog/keep-secrets-away-from-ai-coding-agents-2026), which compares Claude Code,
Codex, Cursor, and Gemini CLI:

1. **File rules.** Deny reads of secret files. Claude Code's `permissions.deny` (`Read(.env)`) covers its Read tool and
   shell commands it recognises (`cat`, `head`, …), not a script the agent writes and runs. Only an OS sandbox
   (`sandbox.filesystem.denyRead`, Codex permission profiles) covers every process.
2. **Environment scrub.** Drop secrets from what the agent's commands inherit. Claude Code:
   `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` (by name or value; leaves `GH_TOKEN`/`GITHUB_TOKEN`). Codex:
   `shell_environment_policy` (`inherit`, `include`/`exclude` globs; its KEY/SECRET/TOKEN default exclusion is off by
   default). **pi-env-guard is this layer for Pi.**
3. **Credential masking.** The agent's commands hold a placeholder; a sandbox proxy swaps in the real value only on
   outbound requests to allowed hosts (Claude Code `sandbox.credentials` with `mode: "mask"` and `injectHosts`, TLS
   termination required). A successful prompt injection then walks away with a placeholder.

Under all three: no plaintext secrets on disk. Keep references (`op://…`) and resolve them at run time; wrap the
command that needs the secret, not the whole agent.

## Direction

- Layer 2 stays small: config file, globs, an allowlist, refill for nested Pi.
- Explore layer 3 for Pi (see `TODO.md`): the keys agents use on purpose (database URLs, API tokens) are the ones
  layer 2 must leave visible, and masking is what would protect them.
- No vault integration in this extension; resolving secrets stays with the user's setup.
