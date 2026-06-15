# SafeFS MCP Client Examples

This directory contains example configuration files for MCP clients.

## Auto Setup

```bash
safefs init --yes --clients codex,cursor,claude,gemini
```

This creates config files for selected clients without overwriting existing files.

Before npm publish, use local checkout mode:

```bash
node dist/cli.js init --local --yes --clients codex,cursor,claude,gemini
```

## Manual Setup

- Claude Code: copy `claude-code/.mcp.json` to your project `.mcp.json`.
- Cursor: copy `cursor/mcp.json` to your project `.cursor/mcp.json`.
- Codex: copy `codex/config.toml` to your project `.codex/config.toml`.
- Gemini CLI: copy `gemini/settings.json` to your project `.gemini/settings.json`.

## Notes

- Gemini CLI tools are exposed with fully qualified names like `mcp_safefs_safe_write`.
- Run `safefs doctor --gemini-smoke` to verify Gemini CLI can see the SafeFS MCP config.
- The `safefs.yml` file is an example `.safefs.yml` project config.
- If installing from a local GitHub checkout, replace `npx -y @tekergul/safefs-mcp` with `node dist/cli.js` for local CLI commands.
