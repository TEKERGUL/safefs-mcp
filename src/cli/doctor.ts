import { constants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadConfig } from "../config/loadConfig.js";
import { resolveSafePath } from "../core/pathSafety.js";
import { SafeFSError, type SafeFSConfig } from "../types/index.js";
import { getAutoGuardStatus } from "./autoGuard.js";

const execFileAsync = promisify(execFile);
const PACKAGE_NAME = "@tekergul/safefs-mcp";
const PACKAGE_LATEST_URL = "https://registry.npmjs.org/@tekergul/safefs-mcp/latest";
const MCP_CONFIG_FILES = [
  ".mcp.json",
  ".cursor/mcp.json",
  ".codex/config.toml",
  ".gemini/settings.json",
] as const;

export interface DoctorCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

export interface DoctorResult {
  ok: boolean;
  checks: DoctorCheck[];
}

export interface DoctorOptions {
  geminiSmoke?: boolean;
  online?: boolean;
  antigravity?: boolean;
  antigravityConfigPath?: string;
}

interface ParsedMcpConfig {
  file: string;
  command?: string;
  args?: string[];
}

export async function runDoctor(
  root: string,
  options: DoctorOptions = {}
): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [];

  checks.push(checkNodeVersion());

  let config: SafeFSConfig;
  try {
    config = await loadConfig(root);
    checks.push({
      name: "config",
      status: "pass",
      message: ".safefs.yml is valid or defaults are usable.",
    });
  } catch (err) {
    checks.push({
      name: "config",
      status: "fail",
      message: err instanceof Error ? err.message : "Failed to load config.",
    });
    printDoctor(checks);
    return { ok: false, checks };
  }

  checks.push(await checkSafefsStorage(root));
  checks.push(await checkMandatoryProtection(root, config));
  checks.push(await checkMcpConfig(root));
  checks.push(await checkAutoGuard(root));
  const installModeCheck = await checkInstallMode(root);
  if (installModeCheck) checks.push(installModeCheck);
  checks.push(await checkPackageBinary(root));
  if (options.online) checks.push(await checkNpmPackageReachable());
  if (options.geminiSmoke) checks.push(await checkGeminiSmoke(root));
  if (options.antigravity) {
    checks.push(await checkAntigravityConfig(root, options.antigravityConfigPath));
  }

  printDoctor(checks);
  return {
    ok: !checks.some((check) => check.status === "fail"),
    checks,
  };
}

function checkNodeVersion(): DoctorCheck {
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (major >= 20) {
    return {
      name: "node",
      status: "pass",
      message: `Node ${process.versions.node} is supported.`,
    };
  }

  return {
    name: "node",
    status: "fail",
    message: `Node ${process.versions.node} is too old. SafeFS requires Node >=20.`,
  };
}

async function checkSafefsStorage(root: string): Promise<DoctorCheck> {
  const safefsDir = path.join(root, ".safefs");
  try {
    await fs.access(safefsDir, constants.R_OK | constants.W_OK);
    await fs.access(path.join(safefsDir, "timeline"), constants.R_OK | constants.W_OK);
    await fs.access(path.join(safefsDir, "objects"), constants.R_OK | constants.W_OK);
    return {
      name: "storage",
      status: "pass",
      message: ".safefs storage is readable and writable.",
    };
  } catch {
    return {
      name: "storage",
      status: "fail",
      message: "Run `safefs init` to create writable .safefs storage.",
    };
  }
}

async function checkMandatoryProtection(
  root: string,
  config: SafeFSConfig
): Promise<DoctorCheck> {
  try {
    await resolveSafePath({
      root,
      requestedPath: ".env",
      config: { ...config, protected: [] },
    });
    return {
      name: "protection",
      status: "fail",
      message: "Mandatory protected paths can be bypassed.",
    };
  } catch (err) {
    if (err instanceof SafeFSError && err.code === "PROTECTED_PATH") {
      return {
        name: "protection",
        status: "pass",
        message: "Mandatory protected paths are enforced.",
      };
    }

    return {
      name: "protection",
      status: "fail",
      message: err instanceof Error ? err.message : "Protection check failed.",
    };
  }
}

async function checkMcpConfig(root: string): Promise<DoctorCheck> {
  const existing: string[] = [];

  for (const file of MCP_CONFIG_FILES) {
    try {
      await fs.access(path.join(root, file));
      existing.push(file);
    } catch {
      // missing config is a warning, not a broken SafeFS install
    }
  }

  if (existing.length > 0) {
    return {
      name: "mcp-config",
      status: "pass",
      message: `Found MCP config: ${existing.join(", ")}.`,
    };
  }

  return {
    name: "mcp-config",
    status: "warn",
    message: "No MCP client config found. Run `safefs init --yes --clients codex,cursor,claude,gemini`.",
  };
}

async function checkAutoGuard(root: string): Promise<DoctorCheck> {
  const status = await getAutoGuardStatus(root);
  const installedClients = status.clients.filter((client) =>
    client.wrappers.some((wrapper) => wrapper.exists && wrapper.managed)
  );

  if (installedClients.length === 0) {
    return {
      name: "auto-guard",
      status: "warn",
      message: "Project-local auto-guard is not installed. Run `safefs init --auto-guard` or `safefs auto-guard install`.",
    };
  }

  const missingRealCommands = installedClients
    .filter((client) => !client.realCommand)
    .map((client) => client.client);
  if (missingRealCommands.length > 0) {
    return {
      name: "auto-guard",
      status: "warn",
      message: `Auto-guard wrappers exist, but real client commands were not found outside .safefs/bin: ${missingRealCommands.join(", ")}.`,
    };
  }

  if (!status.pathActive) {
    return {
      name: "auto-guard",
      status: "warn",
      message: "Auto-guard wrappers exist, but this shell PATH is not active. Run `Invoke-Expression (safefs auto-guard env powershell)` or `eval \"$(safefs auto-guard env bash)\"`.",
    };
  }

  return {
    name: "auto-guard",
    status: "pass",
    message: `Auto-guard active for: ${installedClients.map((client) => client.client).join(", ")}.`,
  };
}

async function checkAntigravityConfig(
  root: string,
  configPath = getDefaultAntigravityConfigPath()
): Promise<DoctorCheck> {
  let raw: string;
  try {
    raw = await fs.readFile(configPath, "utf-8");
  } catch {
    return {
      name: "antigravity",
      status: "warn",
      message: `Antigravity MCP config not found at ${configPath}. Run \`safefs mcp-config antigravity\` and paste the snippet into that file.`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      name: "antigravity",
      status: "warn",
      message: `Antigravity MCP config at ${configPath} is not valid JSON.`,
    };
  }

  if (!isRecord(parsed) || !isRecord(parsed.mcpServers) || !isRecord(parsed.mcpServers.safefs)) {
    return {
      name: "antigravity",
      status: "warn",
      message: `Antigravity MCP config does not contain mcpServers.safefs. Run \`safefs mcp-config antigravity\` for the snippet.`,
    };
  }

  const safefs = parsed.mcpServers.safefs;
  const command = typeof safefs.command === "string" ? safefs.command : undefined;
  const args = Array.isArray(safefs.args)
    ? safefs.args.filter((arg): arg is string => typeof arg === "string")
    : [];

  if (!command || !isRecognizedMcpCommand(command)) {
    return {
      name: "antigravity",
      status: "warn",
      message: "Antigravity SafeFS config should use a recognizable `npx` or `node` command.",
    };
  }

  const rootArg = getArgValue(args, "--root");
  if (!rootArg) {
    return {
      name: "antigravity",
      status: "warn",
      message: "Antigravity SafeFS config is missing `--root <absolute-project-root>`.",
    };
  }

  if (!path.isAbsolute(rootArg)) {
    return {
      name: "antigravity",
      status: "warn",
      message: `Antigravity SafeFS config uses a relative root (${rootArg}). Re-run \`safefs mcp-config antigravity\` from this project.`,
    };
  }

  if (normalizePathForCompare(rootArg) !== normalizePathForCompare(root)) {
    return {
      name: "antigravity",
      status: "warn",
      message: `Antigravity SafeFS config points to ${rootArg}, not this project (${path.resolve(root)}).`,
    };
  }

  return {
    name: "antigravity",
    status: "pass",
    message: "Antigravity MCP config contains SafeFS for this project.",
  };
}
async function checkInstallMode(root: string): Promise<DoctorCheck | undefined> {
  const configs = await readMcpConfigs(root);
  if (configs.length === 0) return undefined;

  const localConfigs = configs.filter(isLocalConfig);
  const npmConfigs = configs.filter(isNpmConfig);

  if (localConfigs.length > 0 && npmConfigs.length > 0) {
    return {
      name: "install-mode",
      status: "warn",
      message: "Mixed MCP install modes found. Re-run `safefs init` for one consistent mode.",
    };
  }

  if (localConfigs.length > 0) {
    const missing = await findMissingLocalCliPaths(localConfigs);
    if (missing.length > 0) {
      return {
        name: "install-mode",
        status: "warn",
        message: `Local MCP config points to missing CLI path: ${missing.join(", ")}.`,
      };
    }

    return {
      name: "install-mode",
      status: "pass",
      message: "MCP configs use local checkout mode.",
    };
  }

  if (npmConfigs.length > 0) {
    return {
      name: "install-mode",
      status: "pass",
      message: `MCP configs use npm package mode (${PACKAGE_NAME}). Use --online to verify npm reachability.`,
    };
  }

  return {
    name: "install-mode",
    status: "warn",
    message: "MCP config exists but SafeFS command mode could not be recognized.",
  };
}

async function readMcpConfigs(root: string): Promise<ParsedMcpConfig[]> {
  const configs: ParsedMcpConfig[] = [];

  for (const file of MCP_CONFIG_FILES) {
    const fullPath = path.join(root, file);
    try {
      const raw = await fs.readFile(fullPath, "utf-8");
      configs.push(parseMcpConfig(file, raw));
    } catch {
      // Missing or unreadable client configs are handled by checkMcpConfig.
    }
  }

  return configs;
}

function parseMcpConfig(file: string, raw: string): ParsedMcpConfig {
  if (file.endsWith(".toml")) {
    return parseTomlMcpConfig(file, raw);
  }

  return parseJsonMcpConfig(file, raw);
}

function parseJsonMcpConfig(file: string, raw: string): ParsedMcpConfig {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return { file };

    const servers = parsed.mcpServers;
    if (!isRecord(servers)) return { file };

    const safefs = servers.safefs;
    if (!isRecord(safefs)) return { file };

    return {
      file,
      command: typeof safefs.command === "string" ? safefs.command : undefined,
      args: Array.isArray(safefs.args)
        ? safefs.args.filter((arg): arg is string => typeof arg === "string")
        : undefined,
    };
  } catch {
    return { file };
  }
}

function parseTomlMcpConfig(file: string, raw: string): ParsedMcpConfig {
  const commandMatch = raw.match(/^command\s*=\s*("(?:\\.|[^"\\])*")/m);
  const argsMatch = raw.match(/^args\s*=\s*\[([^\]]*)\]/m);

  return {
    file,
    command: commandMatch?.[1] ? parseQuotedString(commandMatch[1]) : undefined,
    args: argsMatch?.[1] ? parseTomlStringArray(argsMatch[1]) : undefined,
  };
}

function parseTomlStringArray(raw: string): string[] {
  const matches = raw.match(/"(?:\\.|[^"\\])*"/g) ?? [];
  return matches
    .map((match) => parseQuotedString(match))
    .filter((value): value is string => value !== undefined);
}

function parseQuotedString(raw: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getDefaultAntigravityConfigPath(): string {
  return path.join(os.homedir(), ".gemini", "config", "mcp_config.json");
}

function isRecognizedMcpCommand(command: string): boolean {
  const basename = path.basename(command).toLowerCase().replace(/\.(cmd|exe)$/i, "");
  return basename === "npx" || basename === "node";
}

function getArgValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function normalizePathForCompare(value: string): string {
  const normalized = path.resolve(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isNpmConfig(config: ParsedMcpConfig): boolean {
  return config.command === "npx" && (config.args ?? []).includes(PACKAGE_NAME);
}

function isLocalConfig(config: ParsedMcpConfig): boolean {
  return config.command === "node" && findLocalCliPath(config) !== undefined;
}

function findLocalCliPath(config: ParsedMcpConfig): string | undefined {
  return (config.args ?? []).find((arg) => /(^|[\\/])dist[\\/]cli\.js$/i.test(arg));
}

async function findMissingLocalCliPaths(configs: ParsedMcpConfig[]): Promise<string[]> {
  const missing: string[] = [];

  for (const config of configs) {
    const cliPath = findLocalCliPath(config);
    if (!cliPath) continue;

    try {
      await fs.access(cliPath, constants.R_OK);
    } catch {
      missing.push(cliPath);
    }
  }

  return [...new Set(missing)];
}

async function checkPackageBinary(root: string): Promise<DoctorCheck> {
  try {
    const raw = await fs.readFile(path.join(root, "package.json"), "utf-8");
    const pkg: unknown = JSON.parse(raw);
    if (!isRecord(pkg) || pkg.name !== PACKAGE_NAME) {
      return {
        name: "binary",
        status: "pass",
        message: "Package binary check skipped outside the SafeFS source checkout.",
      };
    }
  } catch {
    return {
      name: "binary",
      status: "pass",
      message: "Package binary check skipped outside the SafeFS source checkout.",
    };
  }

  try {
    await fs.access(path.join(root, "dist", "cli.js"));
    return {
      name: "binary",
      status: "pass",
      message: "dist/cli.js exists for package bin entry.",
    };
  } catch {
    return {
      name: "binary",
      status: "warn",
      message: "dist/cli.js is missing. Run `pnpm build` before publishing.",
    };
  }
}

async function checkNpmPackageReachable(): Promise<DoctorCheck> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(PACKAGE_LATEST_URL, { signal: controller.signal });
    if (!response.ok) throw new Error(`npm registry returned ${response.status}`);

    const metadata: unknown = await response.json();
    const version =
      isRecord(metadata) && typeof metadata.version === "string" ? metadata.version : undefined;

    if (version) {
      return {
        name: "npm",
        status: "pass",
        message: `${PACKAGE_NAME} is reachable on npm at version ${version}.`,
      };
    }
  } catch {
    // Report a warning below; npm reachability should not make local usage fail.
  } finally {
    clearTimeout(timeout);
  }

  return {
    name: "npm",
    status: "warn",
    message: `${PACKAGE_NAME} is not reachable from npm yet. Use \`safefs init --local\` for local checkout installs.`,
  };
}

async function checkGeminiSmoke(root: string): Promise<DoctorCheck> {
  const geminiCommand = process.platform === "win32" ? "cmd.exe" : "gemini";
  const geminiArgs =
    process.platform === "win32" ? ["/d", "/s", "/c", "gemini.cmd", "mcp", "list"] : ["mcp", "list"];
  try {
    const { stdout, stderr } = await execFileAsync(geminiCommand, geminiArgs, {
      cwd: root,
      timeout: 15000,
      windowsHide: true,
    });
    const output = `${stdout}\n${stderr}`;
    if (output.toLowerCase().includes("safefs")) {
      return {
        name: "gemini",
        status: "pass",
        message: "Gemini CLI sees a SafeFS MCP server config.",
      };
    }

    return {
      name: "gemini",
      status: "warn",
      message: "Gemini CLI ran, but `gemini mcp list` did not show SafeFS.",
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown error";
    return {
      name: "gemini",
      status: "warn",
      message: `Gemini CLI smoke check could not run (${reason}). Install/authenticate Gemini CLI, then retry \`safefs doctor --gemini-smoke\`.`,
    };
  }
}

function printDoctor(checks: DoctorCheck[]): void {
  console.log("SafeFS doctor");
  console.log("");

  for (const check of checks) {
    console.log(`${check.status.toUpperCase().padEnd(4)} ${check.name.padEnd(12)} ${check.message}`);
  }
}
