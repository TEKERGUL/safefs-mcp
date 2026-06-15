# Contributing to SafeFS MCP

Thanks for helping make AI-assisted coding safer.

## Getting Started

**Prerequisites:**
- Node.js >= 20.0.0
- `pnpm` (Corepack enabled is recommended)

```bash
git clone https://github.com/tekergul/safefs-mcp.git
cd safefs-mcp
pnpm install
pnpm lint
pnpm test
pnpm build
```

## Development Commands

```bash
pnpm dev           # Run the MCP server in development mode
pnpm lint          # Type-check
pnpm test          # Run Vitest
pnpm test:watch    # Run tests in watch mode
pnpm build         # Build dist/
npm pack --dry-run # Check published package contents
```

## Safety Rules

1. Keep SafeFS lightweight. Do not add databases, Docker, daemons, or network requirements for core behavior.
2. Every public file operation must validate workspace paths and mandatory protected paths.
3. Every mutation must store enough before-change data for rollback.
4. Timeline events are append-only. Existing event formats must remain readable.
5. Rollback must never overwrite manual post-agent edits without an explicit future design.
6. Do not add shell execution, eval, or dynamic code loading based on user input.

## Pull Request Checklist

- Add or update tests for behavior changes.
- Run `pnpm lint`.
- Run `pnpm test`.
- Run `pnpm build`.
- Run `npm pack --dry-run` when package contents or build output changes.
- Update README, SECURITY, or examples if public behavior changes.

## Architecture

- `src/core/` contains path safety, timeline, object store, diff, and rollback logic.
- `src/tools/` contains MCP tool wrappers.
- `src/cli/` contains command handlers.
- `src/config/` contains config defaults and validation.
- `tests/` contains filesystem-heavy Vitest tests.

## Reporting Issues

Use GitHub Issues for bugs and feature requests. For security vulnerabilities, follow [SECURITY.md](SECURITY.md).
