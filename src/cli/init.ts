import fs from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { DEFAULT_CONFIG_YAML } from "../config/defaultConfig.js";
import { getAutoGuardCompatibleClients, installAutoGuard } from "./autoGuard.js";
import type { AutoGuardInstallResult } from "./autoGuard.js";

export type InitClient = "codex" | "cursor" | "claude" | "gemini" | "antigravity";
export type InitInstallMode = "npm" | "local";

export interface InitOptions {
  yes?: boolean;
  clients?: InitClient[];
  local?: boolean;
  localCliPath?: string;
  autoGuard?: boolean;
}

export interface InitResult {
  created: string[];
  updated: string[];
  skipped: string[];
  clients: InitClient[];
  installMode: InitInstallMode;
  autoGuard?: AutoGuardInstallResult;
}

interface ClientFile {
  file: string;
  content: string;
}

interface McpCommandSpec {
  command: string;
  args: string[];
}

const PACKAGE_NAME = "@tekergul/safefs-mcp";
const DEFAULT_INIT_CLIENTS: InitClient[] = ["codex", "cursor", "claude", "gemini"];
const INIT_CLIENT_PROMPT = "codex,cursor,claude,gemini,antigravity";

const AGENTS_MD = [
  "# SafeFS Agent Rules",
  "",
  "SafeFS is installed as a guard for AI coding sessions. You may use normal file editing tools; SafeFS watch/guard records native file changes in the background for rollback.",
  "",
  "Use SafeFS MCP tools for recovery and inspection:",
  "",
  "- Use `safe_diff` to preview rollback changes.",
  "- Use `safe_timeline` to inspect recent agent changes.",
  "- Use `safe_rollback_time` with `dryRun: true` before applying rollback.",
  "- Use `safe_storage_status` to inspect SafeFS storage.",
  "",
  "Legacy write tools may exist for compatibility, but guard/watch mode is preferred for normal edits.",
  "",
  "Note for Gemini CLI: MCP tools may appear with the server alias prefix, such as `mcp_safefs_safe_diff`.",
  "Note for Antigravity: use `safefs mcp-config antigravity` for the global MCP snippet, and run `safefs watch` while using the IDE.",
  "",
  "Safety rules:",
  "",
  "- Never access `.safefs/` internals directly.",
  "- Never modify `.git/`, `.env`, secret keys, package tokens, cloud credentials, or protected paths.",
  "- Before broad changes, explain the intended change.",
  "- For rollback, dry-run first unless the user explicitly asks to apply immediately.",
  "",
].join("\n");

export async function runInit(
  root: string,
  options: InitOptions = {}
): Promise<InitResult> {
  const installMode: InitInstallMode = options.local ? "local" : "npm";
  const commandSpec = createMcpCommandSpec(options);
  const clients = await selectClients(options);
  const result: InitResult = {
    created: [],
    updated: [],
    skipped: [],
    clients,
    installMode,
  };

  const safefsDir = path.join(root, ".safefs");
  await fs.mkdir(path.join(safefsDir, "timeline"), { recursive: true });
  await fs.mkdir(path.join(safefsDir, "objects"), { recursive: true });
  result.created.push(".safefs/");

  await writeIfMissing(
    root,
    ".safefs/timeline/events.jsonl",
    "",
    result,
    "SafeFS timeline"
  );
  await writeIfMissing(root, ".safefs.yml", DEFAULT_CONFIG_YAML, result, "config");
  await appendGitignore(root, result);
  await writeIfMissing(root, "AGENTS.md", AGENTS_MD, result, "agent rules");

  for (const client of result.clients) {
    const target = createClientFile(client, commandSpec);
    if (!target) continue;
    await writeIfMissing(root, target.file, target.content, result, `${client} MCP config`);
  }

  const autoGuardClients = getAutoGuardCompatibleClients(result.clients);
  if (await selectAutoGuard(options, result.clients)) {
    result.autoGuard = await installAutoGuard(root, {
      clients: autoGuardClients,
      commandSpec: createAutoGuardCommandSpec(options),
    });
    for (const file of result.autoGuard.created) {
      console.log(`  CREATE ${file} (auto-guard)`);
    }
    for (const file of result.autoGuard.skipped) {
      console.log(`  SKIP ${file} already exists; not overwritten (auto-guard)`);
    }
  }

  printInitSummary(result);
  return result;
}

async function selectClients(options: InitOptions): Promise<InitClient[]> {
  if (options.clients !== undefined) {
    return uniqueClients(options.clients);
  }

  if (options.yes) {
    return DEFAULT_INIT_CLIENTS;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return [];
  }

  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(
      `Create MCP configs for which clients? [${INIT_CLIENT_PROMPT}] `
    );
    const raw = answer.trim() || INIT_CLIENT_PROMPT;
    return parseClients(raw);
  } finally {
    rl.close();
  }
}

async function selectAutoGuard(options: InitOptions, clients: InitClient[]): Promise<boolean> {
  const autoGuardClients = getAutoGuardCompatibleClients(clients);
  if (options.autoGuard !== undefined) {
    return options.autoGuard && autoGuardClients.length > 0;
  }

  if (options.yes || autoGuardClients.length === 0) {
    return false;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return false;
  }

  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question("Install project-local auto-guard wrappers? [Y/n] ");
    return answer.trim().toLowerCase() !== "n";
  } finally {
    rl.close();
  }
}

function parseClients(raw: string): InitClient[] {
  const allowed = new Set<InitClient>(["codex", "cursor", "claude", "gemini", "antigravity"]);
  return uniqueClients(
    raw
      .split(",")
      .map((client) => client.trim().toLowerCase())
      .filter((client): client is InitClient => allowed.has(client as InitClient))
  );
}

function uniqueClients(clients: InitClient[]): InitClient[] {
  return [...new Set(clients)];
}

function createMcpCommandSpec(options: InitOptions): McpCommandSpec {
  if (!options.local) {
    return {
      command: "npx",
      args: ["-y", PACKAGE_NAME, "serve", "--root", "."],
    };
  }

  return {
    command: "node",
    args: [path.resolve(options.localCliPath ?? path.join("dist", "cli.js")), "serve", "--root", "."],
  };
}

function createAutoGuardCommandSpec(options: InitOptions): McpCommandSpec {
  if (!options.local) {
    return {
      command: "safefs",
      args: [],
    };
  }

  return {
    command: "node",
    args: [path.resolve(options.localCliPath ?? path.join("dist", "cli.js"))],
  };
}

function createClientFile(client: InitClient, spec: McpCommandSpec): ClientFile | undefined {
  switch (client) {
    case "claude":
      return {
        file: ".mcp.json",
        content: createJsonClientConfig(spec, { type: "stdio", env: {} }),
      };
    case "cursor":
      return {
        file: ".cursor/mcp.json",
        content: createJsonClientConfig(spec, { type: "stdio", env: {} }),
      };
    case "codex":
      return {
        file: ".codex/config.toml",
        content: createCodexConfig(spec),
      };
    case "gemini":
      return {
        file: ".gemini/settings.json",
        content: createJsonClientConfig(spec, { timeout: 600000, trust: false }),
      };
    case "antigravity":
      return undefined;
  }
}

function createJsonClientConfig(
  spec: McpCommandSpec,
  extra: Record<string, unknown>
): string {
  return `${JSON.stringify(
    {
      mcpServers: {
        safefs: {
          ...extra,
          command: spec.command,
          args: spec.args,
        },
      },
    },
    null,
    2
  )}\n`;
}

function createCodexConfig(spec: McpCommandSpec): string {
  const args = spec.args.map((arg) => JSON.stringify(arg)).join(", ");
  return `[mcp_servers.safefs]
enabled = true
command = ${JSON.stringify(spec.command)}
args = [${args}]
startup_timeout_sec = 10
tool_timeout_sec = 60
default_tools_approval_mode = "prompt"
enabled_tools = [
  "safe_read_file",
  "safe_diff",
  "safe_timeline",
  "safe_rollback_time",
  "safe_storage_status"
]
`;
}

async function writeIfMissing(
  root: string,
  relativePath: string,
  content: string,
  result: InitResult,
  label: string
): Promise<void> {
  const targetPath = path.join(root, relativePath);

  try {
    await fs.access(targetPath);
    result.skipped.push(relativePath);
    console.log(`  SKIP ${relativePath} already exists; not overwritten (${label})`);
    return;
  } catch {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, content, "utf-8");
    result.created.push(relativePath);
    console.log(`  CREATE ${relativePath} (${label})`);
  }
}

async function appendGitignore(root: string, result: InitResult): Promise<void> {
  const gitignorePath = path.join(root, ".gitignore");
  const entry = ".safefs/";

  try {
    const content = await fs.readFile(gitignorePath, "utf-8");
    if (content.split(/\r?\n/).includes(entry)) {
      result.skipped.push(".gitignore");
      console.log("  SKIP .gitignore already contains .safefs/");
      return;
    }

    const separator = content.endsWith("\n") ? "" : "\n";
    await fs.appendFile(gitignorePath, `${separator}${entry}\n`, "utf-8");
    result.updated.push(".gitignore");
    console.log("  UPDATE .gitignore");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      await fs.writeFile(gitignorePath, `${entry}\n`, "utf-8");
      result.created.push(".gitignore");
      console.log("  CREATE .gitignore");
      return;
    }
    throw err;
  }
}

function printInitSummary(result: InitResult): void {
  console.log("");
  console.log("SafeFS initialized.");
  console.log(
    `Created: ${result.created.length} | Updated: ${result.updated.length} | Skipped: ${result.skipped.length}`
  );
  console.log(`Install mode: ${result.installMode === "local" ? "local checkout" : "npm package"}`);

  if (result.clients.length > 0) {
    const generatedClients = result.clients.filter((client) => client !== "antigravity");
    console.log(`MCP configs: ${generatedClients.length > 0 ? generatedClients.join(", ") : "none generated"}`);
    if (result.clients.includes("antigravity")) {
      console.log("MCP snippets: antigravity (run `safefs mcp-config antigravity`)");
    }
  } else {
    console.log("MCP configs: none selected");
  }

  if (result.autoGuard) {
    console.log(`Auto-guard: ${result.autoGuard.created.length} created | ${result.autoGuard.skipped.length} skipped`);
  } else {
    console.log("Auto-guard: not installed");
  }

  if (result.clients.includes("antigravity")) {
    console.log("Watch-first clients: antigravity (run `safefs watch` before opening Antigravity)");
  }

  console.log("");
  console.log("Next:");
  console.log("  safefs doctor");
  const antigravitySelected = result.clients.includes("antigravity");
  if (result.autoGuard) {
    if (process.platform === "win32") {
      console.log("  Invoke-Expression (safefs auto-guard env powershell)");
    } else {
      console.log("  eval \"$(safefs auto-guard env bash)\"");
    }
  }
  if (antigravitySelected) {
    console.log("  safefs mcp-config antigravity");
    console.log("  safefs watch");
  }
  console.log("  safefs guard -- claude");
  if (!antigravitySelected) {
    console.log("  safefs watch");
  }
  console.log("  safefs timeline --since 1h");
}
