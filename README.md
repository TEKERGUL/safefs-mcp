<div align="center">
  <h1>SafeFS MCP</h1>
  <p><em>A lightweight time machine for AI coding agents.</em></p>
  
  [![npm version](https://img.shields.io/npm/v/@tekergul/safefs-mcp.svg?style=flat-square)](https://www.npmjs.com/package/@tekergul/safefs-mcp)
  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
  [![Node.js Version](https://img.shields.io/node/v/@tekergul/safefs-mcp.svg?style=flat-square)](https://nodejs.org)
  [![Tests](https://img.shields.io/badge/tests-101%20passing-success.svg?style=flat-square)](#)
</div>

<br />

AI agents can edit a lot of files before you notice a mistake. **SafeFS** wraps agent file operations with before-change snapshots, an append-only timeline, conflict checks, rollback mechanisms, and diff previews. 

No Git branches, Docker containers, or databases required. Just local, lightweight file safety.

## ✨ Features

- 🕒 **Time Machine:** Roll back AI agent changes from the last `15m`, `1h`, `3h`, `1d`, or a specific ISO timestamp.
- 🔍 **Preview Before Applying:** View rollbacks as unified diffs before actually applying them.
- 🎯 **Surgical Precision:** Restore a single file without resetting the whole project.
- 🛡️ **Conflict Detection:** Detects manual edits made *after* agent changes and automatically skips conflicts to prevent accidental overwrites.
- 📦 **Zero Dependencies:** Works locally without Git, Docker, daemons, or databases. Stores only touched content in a compressed SHA-256 object store.
- 🤖 **Universal Compatibility:** Supports [Cursor](https://cursor.sh), [Claude Code](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview), [Codex](https://github.com/microsoft/vscode-codex), Roo Code, Cline, and any other MCP-enabled client.

---

## 🚀 Quick Start

**Prerequisite:** Node.js 20.0.0 or later.

Run the interactive setup command in your project root. This will automatically detect and configure your installed MCP clients!

```bash
npx -y @tekergul/safefs-mcp init --yes --clients codex,cursor,claude
```

**What this does:**
- Creates a `.safefs/` local storage directory.
- Generates a `.safefs.yml` configuration file.
- Creates `AGENTS.md` instructions for the AI.
- Adds `.safefs/` to your `.gitignore`.
- Injects MCP configuration snippets for your selected clients.

*(Existing files are never overwritten.)*

---

## 💻 CLI Commands

Check your installation and manually interact with SafeFS timelines:

```bash
# Verify installation and storage integrity
safefs doctor

# View the timeline of recent agent edits
safefs timeline --since 3h

# Preview rollback changes as a Git-style diff
safefs diff --since 1h
safefs diff --since 1d --path src/auth/login.ts

# Apply the rollback (Defaults to dry-run! Use --yes to confirm)
safefs rollback 1h
safefs rollback 1h --yes

# View storage stats
safefs storage
```

---

## 🛠️ MCP Tools Exposed to AI

When SafeFS is configured, your AI agent will be instructed to use the following MCP tools instead of raw system file operations:

- `safe_read_file` - Read files safely
- `safe_write` - Write with automatic before-snapshots
- `safe_patch` - Edit files precisely using diff blocks
- `safe_delete` - Safely remove files
- `safe_diff` - Agent can preview rollback diffs
- `safe_timeline` - Agent can review its own history
- `safe_rollback_time` - Agent can trigger its own rollback if it detects a mistake
- `safe_storage_status` - Monitor storage limits

---

## 🏗️ Architecture & How It Works

1. **Intercept:** SafeFS writes a `pending` timeline event *before* any mutation occurs.
2. **Snapshot:** It stores the exact before-change content in a local `.safefs/objects/` store.
3. **Mutate:** It applies the write, patch, or delete operation securely using temporary atomic writes and mutex locks.
4. **Commit:** It appends a `committed` or `failed` event matching the original ID.
5. **Rollback:** Groups committed events by file, validates current file hashes against the timeline, checks for conflicts (manual user edits), and restores the exact state prior to the agent's involvement.

If a file was modified by a human *after* the agent's edit, SafeFS detects the hash mismatch and **skips** the file, reporting a conflict to keep your manual work safe!

---

## 🔒 Security Model

SafeFS is designed with security-first principles:

- **Path Restrictions:** All operations must stay strictly inside the workspace root.
- **Mandatory Protections:** `.git/`, `.safefs/`, `.env*`, SSH keys, secrets, and common build/vendor folders are hard-coded protected paths.
- **Symlink Blocks:** Symlink escapes are blocked by default.
- **No Remote Execution:** No shell execution (`eval`, `exec`) and no network access are required or used.
- **Append-only Logs:** Timeline events are strictly append-only.

For a detailed breakdown, please read our [SECURITY.md](SECURITY.md).

---

## ⚙️ Manual Configuration

If the `init` command doesn't cover your workflow, you can manually configure your MCP client. Check out the [`examples/`](examples/) directory for specific configuration templates for **Claude Code**, **Cursor**, and **Codex**.

<details>
<summary><strong>Claude Code Example</strong></summary>

Add this to your project's `.mcp.json`:

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
</details>

<details>
<summary><strong>Cursor Example</strong></summary>

Add the same JSON structure above to your `.cursor/mcp.json` file.
</details>

<details>
<summary><strong>Codex Example</strong></summary>

Add this to `.codex/config.toml`:

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
</details>

---

## 🚧 Current Limitations (v1.0.0)

- Directory deletion is intentionally blocked in 1.0 (Delete files individually).
- Function-level and exact line-range specific rollback are planned for later releases.
- Timeline pruning and object compression (gc) are not enabled in 1.0.
- **Note:** SafeFS complements Git; it does not replace proper commits, branching, or remote backups.

---

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to set up the development environment, run the 100+ automated test suite, and submit Pull Requests.

## 📄 License

This project is licensed under the [MIT License](LICENSE).
