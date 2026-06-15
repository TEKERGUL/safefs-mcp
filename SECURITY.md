# Security Policy

## Overview

SafeFS MCP intentionally performs filesystem operations for AI coding agents. Its job is to make those operations observable and reversible with path validation, before-change snapshots, an append-only timeline, diff previews, and conflict-aware rollback.

## What SafeFS Does

- Reads, writes, patches, and deletes files inside a configured workspace root
- Stores before-change snapshots in `.safefs/objects/`
- Records pending, committed, and failed mutation events in `.safefs/timeline/events.jsonl`
- Provides timeline, diff, storage, and rollback tools

## What SafeFS Does Not Do

- Execute arbitrary shell commands
- Access files outside the workspace root
- Follow symlinks that escape the workspace by default
- Expose `.safefs/` internals through public MCP tools
- Allow project config to disable mandatory protected paths
- Require network access, Docker, a daemon, or a database

## Mandatory Protected Paths

SafeFS always blocks critical paths even if `.safefs.yml` sets `protected: []`.

Mandatory protections include:

- `.git/`
- `.safefs/`
- `.env` and `.env.*`
- private keys such as `*.pem`, `*.key`, `id_rsa`, and `id_ed25519`
- `secrets/`
- common generated/vendor folders such as `node_modules/`, `dist/`, `build/`, `.next/`, and `coverage/`

User config can add more protected patterns but cannot remove these protections.

## Rollback Safety

- Rollback defaults to dry-run
- `safe_diff` previews rollback as unified diffs
- Rollback only uses committed mutation events
- Pending and failed events remain visible in the timeline but are not rolled back
- Files modified after an agent change are reported as conflicts and skipped
- Timeline paths are revalidated during rollback before any restore or delete happens

## Recommendations

1. Run `safefs doctor` after installation.
2. Review `safefs diff --since <time>` before applying rollback.
3. Use `safefs rollback <time> --yes` only after reviewing the dry run.
4. Pin `@tekergul/safefs-mcp` to a specific version in production-like environments.
5. Keep using Git. SafeFS complements Git; it is not a replacement for commits or backups.

## Reporting Vulnerabilities

Please do not open a public issue for security vulnerabilities.

Send a private report with:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix, if known

Use GitHub Security Advisories or email the maintainer listed for the project.

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |
| 1.x     | Yes       |
