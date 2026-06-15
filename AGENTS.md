# SafeFS Agent Rules

When SafeFS MCP tools are available, do not directly write, overwrite, patch, or delete project files.

Use SafeFS tools for file changes:

- Use `safe_read_file` to inspect files.
- Use `safe_write` for full file writes.
- Use `safe_patch` for targeted replacements.
- Use `safe_delete` only for file deletion.
- Use `safe_diff` to preview rollback changes.
- Use `safe_timeline` to inspect recent agent changes.
- Use `safe_rollback_time` with `dryRun: true` before applying rollback.
- Use `safe_storage_status` to inspect SafeFS storage.

Safety rules:

- Never access `.safefs/` internals directly.
- Never modify `.git/`, `.env`, secret keys, or protected paths.
- Before broad changes, explain the intended change.
- After making changes, summarize the SafeFS event IDs.
- For rollback, dry-run first unless the user explicitly asks to apply immediately.
