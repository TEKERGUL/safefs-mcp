# SafeFS Agent Rules

SafeFS is installed as a guard for AI coding sessions. You may use normal file editing tools; SafeFS watch/guard records native file changes in the background for rollback.

Use SafeFS MCP tools for recovery and inspection:

- Use `safe_diff` to preview rollback changes.
- Use `safe_timeline` to inspect recent agent changes.
- Use `safe_rollback_time` with `dryRun: true` before applying rollback.
- Use `safe_storage_status` to inspect SafeFS storage.

Legacy write tools may exist for compatibility, but guard/watch mode is preferred for normal edits.

Note for Gemini CLI: MCP tools may appear with the server alias prefix, such as `mcp_safefs_safe_diff`.

Safety rules:

- Never access `.safefs/` internals directly.
- Never modify `.git/`, `.env`, secret keys, package tokens, cloud credentials, or protected paths.
- Before broad changes, explain the intended change.
- For rollback, dry-run first unless the user explicitly asks to apply immediately.