import fs from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { DEFAULT_CONFIG_YAML } from "../config/defaultConfig.js";

export type InitClient = "codex" | "cursor" | "claude" | "gemini";
export type InitInstallMode = "npm" | "local";

export interface InitOptions {
  yes?: boolean;
  clients?: InitClient[];
  local?: boolean;
  localCliPath?: string;
}

export interface InitResult {
  created: string[];
  updated: string[];
  skipped: string[];
  clients: InitClient[];
  installMode: InitInstallMode;
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

const AGENTS_MD = `# SafeFS Agent Rules

When SafeFS MCP tools are available, do not directly write, overwrite, patch, or delete project files.

Use SafeFS tools for file changes:

- Use \`safe_read_file\` to inspect files.
- Use \`safe_write\` for full file writes.
- Use \`safe_patch\` for targeted replacements.
- Use \`safe_delete\` only for file deletion.
- Use \`safe_diff\` to preview rollback changes.
- Use \`safe_timeline\` to inspect recent agent changes.
- Use \`safe_rollback_time\` with \`dryRun: true\` before applying rollback.
- Use \`safe_storage_status\` to inspect SafeFS storage.

Note for Gemini CLI: MCP tools may appear with the server alias prefix, such as \`mcp_safefs_safe_write\`.

Safety rules:

- Never access \`.safefs/\` internals directly.
- Never modify \`.git/\`, \`.env\`, secret keys, or protected paths.
- Before broad changes, explain the intended change.
- After making changes, summarize the SafeFS event IDs.
- For rollback, dry-run first unless the user explicitly asks to apply immediately.
`;

export async function runInit(
  root: string,
  options: InitOptions = {}
): Promise<InitResult> {
  const installMode: InitInstallMode = options.local ? "local" : "npm";
  const commandSpec = createCommandSpec(options);
  const result: InitResult = {
    created: [],
    updated: [],
    skipped: [],
    clients: await selectClients(options),
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
    await writeIfMissing(root, target.file, target.content, result, `${client} MCP config`);
  }

  printInitSummary(result);
  return result;
}

async function selectClients(options: InitOptions): Promise<InitClient[]> {
  if (options.clients !== undefined) {
    return uniqueClients(options.clients);
  }

  if (options.yes) {
    return ["codex", "cursor", "claude", "gemini"];
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return [];
  }

  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(
      "Create MCP configs for which clients? [codex,cursor,claude,gemini] "
    );
    const raw = answer.trim() || "codex,cursor,claude,gemini";
    return parseClients(raw);
  } finally {
    rl.close();
  }
}

function parseClients(raw: string): InitClient[] {
  const allowed = new Set<InitClient>(["codex", "cursor", "claude", "gemini"]);
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

function createCommandSpec(options: InitOptions): McpCommandSpec {
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

function createClientFile(client: InitClient, spec: McpCommandSpec): ClientFile {
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
  "safe_write",
  "safe_patch",
  "safe_delete",
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
    console.log(`MCP configs: ${result.clients.join(", ")}`);
  } else {
    console.log("MCP configs: none selected");
  }

  console.log("");
  console.log("Next:");
  console.log("  safefs doctor");
  console.log("  safefs watch");
  console.log("  safefs timeline --since 1h");
}
