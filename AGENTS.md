# AGENTS.md - AI Assistant Context

Custom pi-coding-agent extensions.

## Development

```bash
just              # List all commands
just compile      # Type-check with tsc
just fmt          # Format with Biome + dprint
just lint         # Lint with Biome
just check        # Format + lint + compile + tests (full check)

just setup-hooks  # Install pre-commit hook
just remove-hooks # Remove pre-commit hook
```

Pre-commit hook runs `just check` before each commit.

## Structure

Each extension is a folder with an `index.ts` entry point plus optional docs/release files:

```
extension-name/
├── index.ts                         # Main extension code
├── README.md                        # Usage docs
├── package.json                     # Standalone package manifest (optional)
├── TODO.md                          # Extension backlog (optional)
├── VISION.md                        # Extension direction (optional)
└── .github/workflows/npm-publish.yml # Standalone publish workflow (optional)
```

Current extensions:

- `deep-review`
- `pi-ghostty-hunk`
- `pi-ghostty-lazygit`
- `pi-jobs`
- `pi-notify`
- `pi-quote-copy`
- `pi-slack-user`
- `pi-system-theme`
- `pi-web`
- `plan-mode`
- `pi-verbosity-control`

## pi-jobs daemon

`pi-jobs/` is both an extension (`index.ts`, a client) and a daemon (`pi-jobs/daemon/`). The daemon is a separate Node program with its own `package.json`, exact-pinned Pi Durable dependencies, and its own `tsconfig.json`; the root `tsconfig.json` excludes it and `just compile` type-checks it with `tsc -p pi-jobs/daemon`. It runs on Node's built-in type stripping (no build step); `daemon/resolve-ts.mjs` maps relative `.js` imports to `.ts` so it can import `pi-web`'s search/fetch modules by relative path. Type stripping does not support enums or constructor parameter properties, so daemon code avoids them. See `pi-jobs/README.md` for install and runtime details.

## Type Checking

Extensions import from pi's packages. The `tsconfig.json` maps these:

- `@earendil-works/pi-coding-agent` - Extension API
- `@earendil-works/pi-agent-core` - Message types
- `@earendil-works/pi-ai` - Content types
- `@earendil-works/pi-tui` - TUI utilities
- `typebox` - Schema types

TypeScript and Vitest resolve these host packages from `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent`.
Install Pi before running checks. `.npmrc` disables automatic peer installation so `npm install` and `npm ci` install the test dependencies without creating a second Pi runtime.

## Style

- Biome handles formatting and linting
- Spaces for indentation (4-space)
- 120 char line width

## Backlog conventions

- Extension-specific backlog lives next to each extension:
  - `deep-review/TODO.md`
  - `pi-ghostty-hunk/TODO.md`
  - `pi-jobs/TODO.md`
  - `pi-system-theme/TODO.md`
  - `plan-mode/TODO.md`
  - `pi-verbosity-control/TODO.md`
- `extensions/TODO.md` is an index/shared file, not a place for one extension's full backlog.
- Package-level integration backlog belongs in repo-root `../TODO.md`.
- When developing in upstream `~/dev/pi-extensions`, keep the same TODO files aligned there.
