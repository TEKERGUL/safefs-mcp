<p align="center">
  <img src="assets/safefs-logo.svg" alt="SafeFS logo" width="112" height="112">
</p>

# SafeFS MCP

[![CI](https://github.com/TEKERGUL/safefs-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/TEKERGUL/safefs-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js >=20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)

AI broke your code? Roll back the last 10 minutes.

SafeFS is a lightweight session guard for AI coding agents. It records local before-change snapshots while Claude Code, Codex, Antigravity, Cursor, editors, or terminals make normal native file edits. No Git commit, Docker daemon, database, or network service is required.

## Quick Start

```powershell
npm install -g @tekergul/safefs-mcp
safefs init --yes --clients claude --auto-guard
Invoke-Expression (safefs auto-guard env powershell)
claude
```

Bash/zsh:

```bash
npm install -g @tekergul/safefs-mcp
safefs init --yes --clients claude --auto-guard
eval "$(safefs auto-guard env bash)"
claude
```

Preview and apply rollback:

```bash
safefs diff 10m
safefs rollback 10m
safefs rollback 10m --yes
```

## Features

- Works even when agents use their native edit tools through guard/watch or project-local auto-guard
- Roll back AI changes from `15m`, `1h`, `3h`, `1d`, `7d`, or an ISO timestamp
- Preview rollback as readable diffs before applying changes
- Restore one file without resetting the whole project
- Skip conflicts when files changed after the recorded edit
- Ignore protected paths, secrets, vendor folders, build output, binary files, and large files by default
- Cache watch state in a local manifest for large projects
- Support Codex, Cursor, Claude Code, Gemini CLI, Roo Code, Cline, and other MCP clients

## CLI

```bash
safefs init
safefs doctor
safefs guard -- claude
safefs auto-guard install --clients claude,codex
safefs auto-guard status
safefs auto-guard env powershell
safefs auto-guard uninstall
safefs watch
safefs watch --dry-run
safefs timeline --since 3h
safefs diff 10m
safefs diff --since 10m
safefs rollback 10m
safefs rollback 10m --yes
safefs storage
safefs prune --days 30
safefs prune --days 30 --yes
safefs gc
safefs gc --yes
```

Rollback defaults to dry-run. Use `--yes` only after reviewing the plan or diff.
Maintenance commands also default to dry-run. `prune` removes old timeline events and `gc` removes unreferenced objects only when `--yes` is provided.

## Auto-Guard, Guard, And Watch Mode

`auto-guard` is the easiest everyday setup. It installs project-local wrappers in `.safefs/bin` and does not modify global shell profiles or global binaries:

```bash
safefs init --yes --clients claude,codex --auto-guard
safefs auto-guard status
```

Activate the current shell, then run your agent normally:

```powershell
Invoke-Expression (safefs auto-guard env powershell)
claude
```

Manual `guard` remains available for explicit sessions:

```bash
safefs guard -- claude
safefs guard -- codex
```

`guard` starts SafeFS watch, runs the command, captures native file writes/deletes/moves, and flushes the final changes when the command exits.

Use `watch` when you want a separate terminal:

```bash
safefs watch
```

Watch mode respects `.gitignore`, protected patterns, file-size limits, stable-write debounce, binary detection, case-collision safety, symlink policy, move detection, and `.safefs/watch/manifest.json` reuse.

## MCP Tools

SafeFS remains an MCP server. The watcher/auto-guard layer captures native edits; MCP tools provide recovery and inspection:

- `safe_read_file`
- `safe_diff`
- `safe_timeline`
- `safe_rollback_time`
- `safe_storage_status`

Legacy write tools remain for compatibility but are no longer the recommended path:

- `safe_write`
- `safe_patch`
- `safe_delete`

Gemini CLI qualifies MCP tool names with the server alias, so SafeFS tools may appear as names like `mcp_safefs_safe_diff`.

## How Rollback Works

1. Guard/watch builds or reuses a local baseline manifest.
2. Native file changes become stable after the debounce window.
3. SafeFS stores before/after content in `.safefs/objects/` and appends committed timeline events.
4. Rollback groups committed events by file, validates current hashes, checks conflicts, and restores the earliest before-change state.
5. Rollback writes a short suppression marker so the watcher does not record rollback itself as a new agent edit.

If a file changed after the recorded edit, rollback skips it and reports the expected/current hashes.

## Security Model

- Paths must stay inside the workspace root
- `.git/`, `.safefs/`, `.env*`, keys, tokens, cloud credentials, secrets, and common build/vendor folders are protected by default
- User config can add protected patterns and watch excludes
- Symlinks are skipped by default; symlink escapes are blocked when following is enabled
- Binary and large files are skipped by watch mode
- Timeline events are append-only
- Timeline pruning and object garbage collection are explicit, dry-run-first maintenance commands

See [SECURITY.md](SECURITY.md).

## Client Configuration

The recommended setup command writes config snippets for selected clients:

```bash
safefs init --yes --clients codex,cursor,claude,gemini --auto-guard
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
  "safe_diff",
  "safe_timeline",
  "safe_rollback_time",
  "safe_storage_status"
]
```

## Limitations

- Directory deletion is intentionally blocked in 1.1
- Function-level and exact line-range rollback are planned for later releases
- Object compression is not enabled in 1.1
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

1. Confirm `pnpm audit`, `pnpm lint`, `pnpm test`, `pnpm build`, `npm pack --dry-run`, and `node dist/cli.js --help` pass locally.
2. Run a clean-project smoke test: global install, `safefs init --yes --clients claude --auto-guard`, shell activation, wrapper launch, `safefs diff 10m`, and rollback dry-run.
3. Push and wait for GitHub Actions to go green.
4. Publish with `npm publish --access public`.
5. Verify npm with `npm view @tekergul/safefs-mcp version` and `safefs doctor --online`.
6. Create a GitHub release with 1.1 notes; demo GIF/logo polish can follow after the release.

## License

MIT
