<p align="center">
  <img src="assets/safefs-logo.svg" alt="SafeFS logo" width="112" height="112">
</p>

# SafeFS MCP

[![CI](https://github.com/TEKERGUL/safefs-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/TEKERGUL/safefs-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js >=20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)

A lightweight time machine for AI coding agents.

AI agents can edit a lot of files before you notice a mistake. SafeFS records before-change snapshots, an append-only timeline, conflict checks, rollback, and diff previews.

SafeFS does not require Git commits, Docker, daemons, databases, or network services. It stores only touched content locally.

## Status

SafeFS is published on npm as `@tekergul/safefs-mcp`.

Install from npm:

```bash
npx -y @tekergul/safefs-mcp init --yes --clients codex,cursor,claude,gemini
npx -y @tekergul/safefs-mcp doctor
```

Or use a local GitHub checkout:

```bash
git clone https://github.com/TEKERGUL/safefs-mcp.git
cd safefs-mcp
pnpm install
pnpm build
node dist/cli.js init --local --yes --clients codex,cursor,claude,gemini
node dist/cli.js doctor
```

## Features

- Roll back AI agent changes from `15m`, `1h`, `3h`, `1d`, `7d`, or an ISO timestamp
- Preview rollback as unified diffs before applying changes
- Restore one file without resetting the whole project
- Detect manual edits after agent changes and skip conflicts
- Watch native file edits from Claude Code, Codex, Antigravity, Cursor, editors, and terminals
- Store touched content in a local SHA-256 object store
- Support Codex, Cursor, Claude Code, Gemini CLI, Roo Code, Cline, and other MCP clients
- Support npm package mode and local checkout mode

## CLI

```bash
safefs doctor
safefs doctor --online
safefs doctor --gemini-smoke
safefs timeline --since 3h
safefs diff --since 1h
safefs diff --since 1d --path src/auth/login.ts
safefs watch
safefs rollback 1h
safefs rollback 1h --yes
safefs storage
```

Rollback defaults to dry-run. Use `--yes` only after reviewing the plan or diff.

## Watch Mode

For clients that prefer their own native file tools, run SafeFS as a lightweight workspace guard:

```bash
safefs watch
```

Watch mode is client-agnostic. It builds a local baseline, ignores protected paths such as `.git/`, `.safefs/`, `.env*`, `node_modules/`, `dist/`, and `build/`, then records committed timeline events when normal file writes, creates, or deletes happen on disk.

Use this when Claude Code, Codex, Antigravity, Cursor, or another editor writes files directly instead of calling SafeFS MCP write tools. Keep the watcher running while the agent works, then use the same rollback commands:

```bash
safefs diff --since 10m
safefs rollback 10m
safefs rollback 10m --yes
```
## MCP Tools

SafeFS exposes:

- `safe_read_file`
- `safe_write`
- `safe_patch`
- `safe_delete`
- `safe_diff`
- `safe_timeline`
- `safe_rollback_time`
- `safe_storage_status`

Gemini CLI qualifies MCP tool names with the server alias, so SafeFS tools may appear as names like `mcp_safefs_safe_write`.

## How Rollback Works

1. SafeFS writes a `pending` timeline event before a mutation.
2. It stores before-change content in `.safefs/objects/`.
3. It applies the write, patch, or delete.
4. It appends a `committed` or `failed` event with the same event id.
5. Rollback groups committed events by file, validates current hashes, checks conflicts, and restores the earliest before-change state.

If a file changed after the agent's last recorded edit, rollback skips it and reports the expected/current hashes.

## Security Model

- Paths must stay inside the workspace root
- `.git/`, `.safefs/`, `.env*`, keys, secrets, and common build/vendor folders are protected by default
- User config can add protected patterns
- Symlink escapes are blocked by default
- `.safefs/` internals are not exposed through public MCP tools
- No shell execution is used by SafeFS tools
- Timeline events are append-only

See [SECURITY.md](SECURITY.md).

## Client Configuration

The recommended setup command writes config snippets for selected clients:

```bash
safefs init --yes --clients codex,cursor,claude,gemini
```

Before the npm package is published, generate local checkout configs instead:

```bash
node dist/cli.js init --local --yes --clients codex,cursor,claude,gemini
```

Manual examples live in [examples/](examples/).

### Gemini CLI

Project config path: `.gemini/settings.json`

```json
{
  "mcpServers": {
    "safefs": {
      "command": "npx",
      "args": ["-y", "@tekergul/safefs-mcp", "serve", "--root", "."],
      "timeout": 600000,
      "trust": false
    }
  }
}
```

To verify that Gemini can see the project config:

```bash
safefs doctor --gemini-smoke
```

### Claude Code / Cursor

Use an `mcpServers` JSON object:

```json
{
  "mcpServers": {
    "safefs": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@tekergul/safefs-mcp", "serve", "--root", "."],
      "env": {}
    }
  }
}
```

### Codex

```toml
[mcp_servers.safefs]
enabled = true
command = "npx"
args = ["-y", "@tekergul/safefs-mcp", "serve", "--root", "."]
startup_timeout_sec = 10
tool_timeout_sec = 60
default_tools_approval_mode = "prompt"
enabled_tools = [
  "safe_read_file",
  "safe_write",
  "safe_patch",
  "safe_delete",
  "safe_diff",
  "safe_timeline",
  "safe_rollback_time",
  "safe_storage_status"
]
```

## Limitations

- Directory deletion is intentionally blocked in 1.0
- Function-level and exact line-range rollback are planned for later releases
- Timeline pruning and object compression are not enabled in 1.0
- SafeFS complements Git; it does not replace commits, branches, or backups

## Development

```bash
pnpm install
pnpm lint
pnpm test
pnpm build
npm pack --dry-run
```

## Release Checklist

1. Confirm `pnpm lint`, `pnpm test`, `pnpm build`, and `npm pack --dry-run` pass locally.
2. Run `safefs doctor --online` after the first npm publish to verify package reachability.
3. Run `safefs doctor --gemini-smoke` in a project initialized with `--clients gemini`.
4. Push a tag only after GitHub Actions is green.
5. Create a GitHub release that links to the npm package and includes the rollback/diff demo.

## License

MIT
