# SafeFS MCP Client Examples

This directory contains example configuration files for MCP clients.

## Auto Setup

Recommended npm setup with project-local auto-guard:

```bash
safefs init --yes --clients codex,cursor,claude,gemini --auto-guard
```

This creates MCP config files, SafeFS guard wrappers, and activation files without overwriting existing files.

Activate the current shell before opening your agent:

```powershell
Invoke-Expression (safefs auto-guard env powershell)
```

```bash
eval "$(safefs auto-guard env bash)"
```

When developing from a local checkout, use local mode:

```bash
node dist/cli.js init --local --yes --clients codex,cursor,claude,gemini --auto-guard
```

## Manual Setup

- Claude Code: copy `claude-code/.mcp.json` to your project `.mcp.json`.
- Cursor: copy `cursor/mcp.json` to your project `.cursor/mcp.json`.
- Codex: copy `codex/config.toml` to your project `.codex/config.toml`.
- Gemini CLI: copy `gemini/settings.json` to your project `.gemini/settings.json`.

## Notes

- SafeFS remains an MCP server for diff, timeline, rollback, and storage status.
- Auto-guard/watch captures native file edits, so agents do not need to use legacy SafeFS write tools.
- Gemini CLI tools are exposed with fully qualified names like `mcp_safefs_safe_diff`.
- Run `safefs doctor --gemini-smoke` to verify Gemini CLI can see the SafeFS MCP config.
- The `safefs.yml` file is an example `.safefs.yml` project config.
- If developing from a local GitHub checkout, replace `npx -y @tekergul/safefs-mcp` with `node dist/cli.js` for local CLI commands.
