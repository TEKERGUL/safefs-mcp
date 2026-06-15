# SafeFS MCP Client Examples

This directory contains example configurations for popular MCP clients. SafeFS exposes standard MCP tools, meaning it is compatible with *any* MCP-enabled AI coding agent.

## Auto-Setup (Recommended)

The easiest way to configure your client is to use the `init` command:

```bash
npx -y @tekergul/safefs-mcp init --yes --clients codex,cursor,claude
```

This command will automatically detect your project and create the appropriate configuration files (`.cursor/mcp.json`, `.codex/config.toml`, `.mcp.json`).

## Manual Setup

If you prefer to set up your MCP client manually, you can use the files in this directory as a reference.

### Claude Code (`claude-code`)
To use SafeFS with Claude Code, copy the contents of `claude-code/mcp.json` into your project's `.mcp.json` file.

### Cursor (`cursor`)
To use SafeFS with Cursor, copy the contents of `cursor/mcp.json` into your project's `.cursor/mcp.json` file. Note that Cursor supports workspace-level MCP configurations.

### Codex / Roo Code / Cline (`codex`)
To use SafeFS with Codex, Roo Code, or Cline, copy the contents of `codex/config.toml` into your project's `.codex/config.toml` or equivalent configuration path depending on the specific fork.

### Custom Configuration (`safefs.yml`)
The `safefs.yml` file is an example of the `.safefs.yml` configuration file that goes in the root of your project. You can use it to override default limits and add custom protected paths.
