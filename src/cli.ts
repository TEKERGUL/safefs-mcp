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
import { runWatch } from "./cli/watch.js";
import { runGuard } from "./cli/guard.js";
import {
  createAutoGuardEnvCommand,
  getAutoGuardCompatibleClients,
  getAutoGuardStatus,
  getDefaultAutoGuardClients,
  installAutoGuard,
  isAutoGuardClient,
  printAutoGuardStatus,
  runAutoGuard,
  uninstallAutoGuard,
} from "./cli/autoGuard.js";
import { createMcpConfigSnippet, isMcpConfigClient } from "./cli/mcpConfig.js";
import type { InitClient } from "./cli/init.js";
import { pruneTimeline } from "./core/timelinePruning.js";
import { collectGarbage } from "./core/objectGC.js";
import { loadConfig } from "./config/loadConfig.js";
import { SafeFSError } from "./types/index.js";

const rawArgs = process.argv.slice(2);
const leadingRoot = parseLeadingRoot(rawArgs);
const args = leadingRoot ? rawArgs.slice(leadingRoot.consumed) : rawArgs;
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
    case "watch":
      await handleWatch();
      break;
    case "guard":
      await handleGuard();
      break;
    case "auto-guard":
      await handleAutoGuard();
      break;
    case "mcp-config":
      await handleMcpConfig();
      break;
    case "prune":
      await handlePrune();
      break;
    case "gc":
      await handleGC();
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
  safefs diff <time>                Preview rollback as unified diffs
  safefs doctor                      Check SafeFS setup health
  safefs watch                       Track native file edits from any client
  safefs guard -- <command>          Run a command with SafeFS watching native edits
  safefs auto-guard <subcommand>     Manage project-local auto-guard wrappers
  safefs mcp-config <client>         Print MCP config snippets for global clients
  safefs prune [--days N] [--yes]   Preview or remove old timeline events
  safefs gc [--yes]                 Preview or remove unreferenced objects
  safefs storage                     Show storage status

Init options:
  --yes                      Run non-interactively
  --clients <list>           Comma-separated clients: codex,cursor,claude,gemini,antigravity
  --local                    Write MCP configs that run this local checkout with node
  --auto-guard               Install project-local wrappers for selected clients

Doctor options:
  --online                   Check whether the npm package is reachable
  --gemini-smoke             Check whether Gemini CLI can see the SafeFS MCP config
  --antigravity              Check Antigravity global MCP config for this project

Watch options:
  --interval <ms>            Polling interval (default: 1000)
  --once                     Build baseline and exit
  --dry-run                  Show watch baseline summary without writing SafeFS state

Auto-guard subcommands:
  install [--clients <list>] Install project-local wrappers
  status                    Show wrapper, PATH, and real-client health
  uninstall                 Remove only SafeFS-managed wrappers and activation files
  env [powershell|cmd|bash|zsh]
                            Print the current-shell activation command
  run <client> -- [args...] Internal wrapper entrypoint

MCP config snippets:
  antigravity                Print JSON for ~/.gemini/config/mcp_config.json

Global options:
  --root <path>              Project root (defaults to current directory)

Timeline options:
  --since <time>    Filter events since time (15m, 1h, 3h, 1d, 7d, ISO)
  --path <path>     Filter events for specific file
  --limit <n>       Limit number of events

Rollback options:
  --path <path>     Only rollback this file
  --yes             Apply rollback (default is dry-run)
  --dry-run         Preview without applying (default)

Examples:
  safefs init --yes --clients codex,cursor,claude,gemini,antigravity
  node dist/cli.js init --local --yes --clients gemini
  safefs mcp-config antigravity
  safefs timeline --since 3h
  safefs diff 1h
  safefs watch
  safefs guard -- claude
  safefs auto-guard install --clients claude,codex
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
    local: args.includes("--local"),
    localCliPath: resolveCurrentCliPath(),
    autoGuard: args.includes("--auto-guard") ? true : undefined,
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

  if (limit !== undefined && Number.isNaN(limit)) {
    console.error("Error: --limit must be a valid number.");
    process.exit(1);
  }

  await runTimeline(root, { since, path: filePath, limit });
}

async function handleRollback(): Promise<void> {
  const root = resolveRoot();
  const since = getFlag("--since") ?? (args[1]?.startsWith("--") ? undefined : args[1]);

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
    console.error("Error: diff requires a time argument.");
    console.error("Example: safefs diff 1h");
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
  const result = await runDoctor(root, {
    online: args.includes("--online"),
    geminiSmoke: args.includes("--gemini-smoke"),
    antigravity: args.includes("--antigravity"),
  });
  if (!result.ok) {
    process.exitCode = 1;
  }
}

async function handleWatch(): Promise<void> {
  const root = resolveRoot();
  const interval = parseOptionalNumberFlag("--interval");
  await runWatch(root, {
    intervalMs: interval,
    once: args.includes("--once"),
    dryRun: args.includes("--dry-run"),
  });
}

async function handleGuard(): Promise<void> {
  const root = resolveRoot();
  const separatorIndex = args.indexOf("--");
  const commandArgs = separatorIndex === -1 ? args.slice(1) : args.slice(separatorIndex + 1);
  const exitCode = await runGuard(root, commandArgs);
  process.exitCode = exitCode;
}

async function handleAutoGuard(): Promise<void> {
  const root = resolveRoot();
  const subcommand = args[1];
  const requestedClients = parseClients(getFlag("--clients"));
  const clients = requestedClients
    ? getAutoGuardCompatibleClients(requestedClients)
    : getDefaultAutoGuardClients();

  switch (subcommand) {
    case "install": {
      if (clients.length === 0) {
        console.error("Error: no wrapper-capable clients selected. Antigravity is watch-first; use `safefs watch`.");
        process.exitCode = 1;
        return;
      }
      const result = await installAutoGuard(root, {
        clients,
        commandSpec: resolveAutoGuardCommandSpec(),
      });
      console.log("SafeFS auto-guard installed.");
      console.log(`Created: ${result.created.length} | Skipped: ${result.skipped.length}`);
      console.log("Next:");
      console.log(`  ${createAutoGuardEnvCommand(root, defaultAutoGuardShell())}`);
      break;
    }
    case "status": {
      printAutoGuardStatus(await getAutoGuardStatus(root, clients));
      break;
    }
    case "uninstall": {
      const result = await uninstallAutoGuard(root);
      console.log("SafeFS auto-guard uninstalled.");
      console.log(`Removed: ${result.removed.length} | Skipped: ${result.skipped.length}`);
      break;
    }
    case "env": {
      const shell = parseAutoGuardShell(args[2]) ?? defaultAutoGuardShell();
      console.log(createAutoGuardEnvCommand(root, shell));
      break;
    }
    case "run": {
      const client = args[2];
      if (!client || !isAutoGuardClient(client)) {
        console.error("Error: auto-guard run requires a wrapper-capable client: claude, codex, cursor, or gemini.");
        process.exitCode = 1;
        return;
      }
      const separatorIndex = args.indexOf("--");
      const passthroughArgs = separatorIndex === -1 ? args.slice(3) : args.slice(separatorIndex + 1);
      process.exitCode = await runAutoGuard(root, client, passthroughArgs);
      break;
    }
    default:
      console.error("Usage: safefs auto-guard install|status|uninstall|env|run");
      process.exitCode = 1;
  }
}

async function handleMcpConfig(): Promise<void> {
  const root = resolveRoot();
  const client = args[1];
  if (!client || !isMcpConfigClient(client)) {
    console.error("Error: mcp-config requires a supported client.");
    console.error("Example: safefs mcp-config antigravity");
    process.exitCode = 1;
    return;
  }

  process.stdout.write(createMcpConfigSnippet(root, client));
}

function resolveAutoGuardCommandSpec(): { command: string; args: string[] } {
  if (args.includes("--local")) {
    return { command: "node", args: [resolveCurrentCliPath()] };
  }
  return { command: "safefs", args: [] };
}

function parseAutoGuardShell(value: string | undefined): "powershell" | "cmd" | "bash" | "zsh" | undefined {
  if (value === "powershell" || value === "cmd" || value === "bash" || value === "zsh") {
    return value;
  }
  return undefined;
}

function defaultAutoGuardShell(): "powershell" | "bash" {
  return process.platform === "win32" ? "powershell" : "bash";
}
async function handlePrune(): Promise<void> {
  const root = resolveRoot();
  const config = await loadConfig(root);
  const daysFlag = getFlag("--days");
  const retentionDays = daysFlag ? parseInt(daysFlag, 10) : config.storage.retentionDays;
  const dryRun = !args.includes("--yes") || args.includes("--dry-run");

  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    console.error("Error: --days must be a positive number.");
    process.exit(1);
  }

  console.log(`${dryRun ? "Previewing" : "Pruning"} timeline events older than ${retentionDays} days...`);
  const result = await pruneTimeline(root, { retentionDays, dryRun });
  console.log(`${dryRun ? "Would prune" : "Pruned"}: ${result.pruned} | Retained: ${result.retained}`);
  if (dryRun && result.pruned > 0) {
    console.log("Run with --yes to apply.");
  }

  if (args.includes("--gc")) {
    await handleGC();
  }
}

async function handleGC(): Promise<void> {
  const root = resolveRoot();
  const dryRun = !args.includes("--yes") || args.includes("--dry-run");
  console.log(`${dryRun ? "Previewing" : "Running"} object store garbage collection...`);
  const result = await collectGarbage(root, { dryRun });
  console.log(
    `${dryRun ? "Would delete" : "Deleted"}: ${result.deleted} | Retained: ${result.retained} | Young skipped: ${result.skippedYoung} | ${dryRun ? "Would free" : "Freed"}: ${formatGCBytes(result.freedBytes)}`
  );
  if (dryRun && result.deleted > 0) {
    console.log("Run with --yes to apply.");
  }
}

function formatGCBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function resolveRoot(): string {
  const rootFlag = getFlag("--root") ?? leadingRoot?.value;
  if (rootFlag) {
    return path.resolve(rootFlag);
  }
  return process.cwd();
}

function parseLeadingRoot(input: string[]): { value: string; consumed: number } | undefined {
  if (input[0] === "--root" && input[1]) {
    return { value: input[1], consumed: 2 };
  }

  if (input[0]?.startsWith("--root=")) {
    return { value: input[0].slice("--root=".length), consumed: 1 };
  }

  return undefined;
}

function getCliArgs(): string[] {
  const separatorIndex = args.indexOf("--");
  return separatorIndex === -1 ? args : args.slice(0, separatorIndex);
}

function resolveCurrentCliPath(): string {
  return path.resolve(process.argv[1] ?? path.join("dist", "cli.js"));
}

function getFlag(name: string): string | undefined {
  const cliArgs = getCliArgs();
  const index = cliArgs.indexOf(name);
  if (index === -1) return undefined;
  return cliArgs[index + 1];
}

function parseOptionalNumberFlag(name: string): number | undefined {
  const value = getFlag(name);
  if (value === undefined) return undefined;

  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.error(`Error: ${name} must be a positive number.`);
    process.exit(1);
  }
  return parsed;
}

function parseClients(
  value: string | undefined
): InitClient[] | undefined {
  if (!value) return undefined;

  const allowed = new Set<InitClient>(["codex", "cursor", "claude", "gemini", "antigravity"]);
  return value
    .split(",")
    .map((client) => client.trim().toLowerCase())
    .filter((client): client is InitClient => allowed.has(client as InitClient));
}

main().catch((err) => {
  if (err instanceof SafeFSError) {
    console.error(`Error [${err.code}]: ${err.message}`);
  } else {
    console.error(`Error: ${(err as Error).message}`);
  }
  process.exit(1);
});
