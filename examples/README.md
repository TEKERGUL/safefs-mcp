# SafeFS MCP Client Examples

This directory contains example configuration files for MCP clients.

## Auto Setup

Recommended npm setup with project-local auto-guard:

```bash
safefs init --yes --clients codex,cursor,claude,gemini,antigravity --auto-guard
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
node dist/cli.js init --local --yes --clients codex,cursor,claude,gemini,antigravity --auto-guard
```

## Manual Setup

- Claude Code: copy `claude-code/.mcp.json` to your project `.mcp.json`.
- Cursor: copy `cursor/mcp.json` to your project `.cursor/mcp.json`.
- Codex: copy `codex/config.toml` to your project `.codex/config.toml`.
- Gemini CLI: copy `gemini/settings.json` to your project `.gemini/settings.json`.
- Antigravity: run `safefs mcp-config antigravity` from the project root and paste the output into `~/.gemini/config/mcp_config.json`. The sample shape is in `antigravity/mcp_config.json`.

## Notes

- SafeFS remains an MCP server for diff, timeline, rollback, and storage status.
- Auto-guard/watch captures native file edits, so agents do not need to use legacy SafeFS write tools.
- Gemini CLI tools are exposed with fully qualified names like `mcp_safefs_safe_diff`.
- Antigravity is watch-first because its MCP config is global/shared; run `safefs watch` while using the IDE.
- Run `safefs doctor --gemini-smoke` to verify Gemini CLI can see the SafeFS MCP config.
- Run `safefs doctor --antigravity` to verify Antigravity's global MCP config points to this project.
- Run `safefs checkup` to inspect timeline/object growth before demos, releases, or long-running sessions.
- Use `safefs prune --days 30 --yes --gc` only after reviewing the dry-run output.
- The `safefs.yml` file is an example `.safefs.yml` project config.
- If developing from a local GitHub checkout, replace `npx -y @tekergul/safefs-mcp` with `node dist/cli.js` for local CLI commands.
