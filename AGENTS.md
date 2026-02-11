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

Each extension is a folder with an `index.ts` entry point:

```
extension-name/
├── index.ts      # Main extension code
└── README.md     # Usage docs
```

Current extensions:

- `deep-review`
- `pi-notify`
- `pi-system-theme`
- `plan-mode`

## Type Checking

Extensions import from pi's packages. The `tsconfig.json` maps these:

- `@mariozechner/pi-coding-agent` - Extension API
- `@mariozechner/pi-agent-core` - Message types
- `@mariozechner/pi-ai` - Content types
- `@mariozechner/pi-tui` - TUI utilities
- `@sinclair/typebox` - Schema types

## Style

- Biome handles formatting and linting
- Spaces for indentation (4-space)
- 120 char line width

## Backlog conventions

- Extension-specific backlog lives next to each extension:
  - `deep-review/TODO.md`
  - `plan-mode/TODO.md`
- `extensions/TODO.md` is an index/shared file, not a place for one extension's full backlog.
- Package-level integration backlog belongs in repo-root `../TODO.md`.
- When developing in upstream `~/dev/pi-extensions`, keep the same TODO files aligned there.
