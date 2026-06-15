#!/usr/bin/env node
import path from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { runInit } from "./cli/init.js";
import { runTimeline } from "./cli/timeline.js";
import { runRollback } from "./cli/rollback.js";
import { runDiff } from "./cli/diff.js";
import { runStorage } from "./cli/storage.js";
import { runDoctor } from "./cli/doctor.js";
import { SafeFSError } from "./types/index.js";

const args = process.argv.slice(2);
const command = args[0];

async function main(): Promise<void> {
  if (command === "--version" || command === "-v") {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const pkg = require("../package.json");
    console.log(`safefs-mcp v${pkg.version}`);
    return;
  }

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  switch (command) {
    case "init":
      await handleInit();
      break;
    case "serve":
      await handleServe();
      break;
    case "timeline":
      await handleTimeline();
      break;
    case "rollback":
      await handleRollback();
      break;
    case "diff":
      await handleDiff();
      break;
    case "storage":
      await handleStorage();
      break;
    case "doctor":
      await handleDoctor();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.error('Run "safefs --help" for usage.');
      process.exit(1);
  }
}

function printHelp(): void {
  console.log(`SafeFS MCP - A lightweight time machine for AI coding agents.

Usage:
  safefs init [options]              Initialize SafeFS in current directory
  safefs serve --root <path>         Start MCP server
  safefs timeline [options]          Show file-change history
  safefs rollback <time> [options]   Rollback agent changes
  safefs diff --since <time>         Preview rollback as unified diffs
  safefs doctor                      Check SafeFS setup health
  safefs storage                     Show storage status

Init options:
  --yes                      Run non-interactively
  --clients <list>           Comma-separated clients: codex,cursor,claude

Timeline options:
  --since <time>    Filter events since time (15m, 1h, 3h, 1d, 7d, ISO)
  --path <path>     Filter events for specific file
  --limit <n>       Limit number of events

Rollback options:
  --path <path>     Only rollback this file
  --yes             Apply rollback (default is dry-run)
  --dry-run         Preview without applying (default)

Examples:
  safefs init --yes --clients codex,cursor,claude
  safefs timeline --since 3h
  safefs diff --since 1h
  safefs rollback 1h
  safefs rollback 1h --yes
  safefs rollback 3h --path src/auth/login.ts --yes
`);
}

async function handleInit(): Promise<void> {
  const root = resolveRoot();
  console.log("Initializing SafeFS...");
  console.log("");
  await runInit(root, {
    yes: args.includes("--yes"),
    clients: parseClients(getFlag("--clients")),
  });
}

async function handleServe(): Promise<void> {
  const root = resolveRoot();
  const server = createServer(root);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function handleTimeline(): Promise<void> {
  const root = resolveRoot();
  const since = getFlag("--since");
  const filePath = getFlag("--path");
  const limitStr = getFlag("--limit");
  const limit = limitStr ? parseInt(limitStr, 10) : undefined;

  if (limit !== undefined && isNaN(limit)) {
    console.error("Error: --limit must be a valid number.");
    process.exit(1);
  }

  await runTimeline(root, { since, path: filePath, limit });
}

async function handleRollback(): Promise<void> {
  const root = resolveRoot();
  const since = args[1];

  if (!since) {
    console.error("Error: rollback requires a time argument.");
    console.error("Example: safefs rollback 1h");
    process.exit(1);
  }

  const filePath = getFlag("--path");
  const yes = args.includes("--yes");
  const dryRun = args.includes("--dry-run") || !yes;

  await runRollback(root, since, { dryRun, path: filePath, yes });
}

async function handleDiff(): Promise<void> {
  const root = resolveRoot();
  const since = getFlag("--since") ?? (args[1]?.startsWith("--") ? undefined : args[1]);

  if (!since) {
    console.error("Error: diff requires --since <time>.");
    console.error("Example: safefs diff --since 1h");
    process.exit(1);
  }

  await runDiff(root, {
    since,
    path: getFlag("--path"),
  });
}

async function handleStorage(): Promise<void> {
  const root = resolveRoot();
  await runStorage(root);
}

async function handleDoctor(): Promise<void> {
  const root = resolveRoot();
  const result = await runDoctor(root);
  if (!result.ok) {
    process.exitCode = 1;
  }
}

function resolveRoot(): string {
  const rootFlag = getFlag("--root");
  if (rootFlag) {
    return path.resolve(rootFlag);
  }
  return process.cwd();
}

function getFlag(name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function parseClients(
  value: string | undefined
): Array<"codex" | "cursor" | "claude"> | undefined {
  if (!value) return undefined;

  const allowed = new Set(["codex", "cursor", "claude"]);
  return value
    .split(",")
    .map((client) => client.trim().toLowerCase())
    .filter((client): client is "codex" | "cursor" | "claude" => allowed.has(client));
}

main().catch((err) => {
  if (err instanceof SafeFSError) {
    console.error(`Error [${err.code}]: ${err.message}`);
  } else {
    console.error(`Error: ${(err as Error).message}`);
  }
  process.exit(1);
});
