import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../config/loadConfig.js";
import { resolveSafePath } from "../core/pathSafety.js";
import { SafeFSError, type SafeFSConfig } from "../types/index.js";

export interface DoctorCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

export interface DoctorResult {
  ok: boolean;
  checks: DoctorCheck[];
}

export async function runDoctor(root: string): Promise<DoctorResult> {
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
  checks.push(await checkPackageBinary(root));

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
  const files = [".mcp.json", ".cursor/mcp.json", ".codex/config.toml"];
  const existing: string[] = [];

  for (const file of files) {
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
    message: "No MCP client config found. Run `safefs init --yes --clients codex,cursor,claude`.",
  };
}

async function checkPackageBinary(root: string): Promise<DoctorCheck> {
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

function printDoctor(checks: DoctorCheck[]): void {
  console.log("SafeFS doctor");
  console.log("");

  for (const check of checks) {
    console.log(`${check.status.toUpperCase().padEnd(4)} ${check.name.padEnd(12)} ${check.message}`);
  }
}
