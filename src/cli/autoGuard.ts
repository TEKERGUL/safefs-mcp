import fs from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { runGuard } from "./guard.js";
import type { InitClient } from "./init.js";

export type AutoGuardClient = InitClient;
export type AutoGuardShell = "powershell" | "cmd" | "bash" | "zsh";

export interface AutoGuardCommandSpec {
  command: string;
  args: string[];
}

export interface AutoGuardInstallOptions {
  clients?: AutoGuardClient[];
  commandSpec?: AutoGuardCommandSpec;
}

export interface AutoGuardFileStatus {
  path: string;
  exists: boolean;
  managed: boolean;
}

export interface AutoGuardClientStatus {
  client: AutoGuardClient;
  wrappers: AutoGuardFileStatus[];
  realCommand?: string;
}

export interface AutoGuardStatus {
  binDir: string;
  pathActive: boolean;
  activationFiles: AutoGuardFileStatus[];
  clients: AutoGuardClientStatus[];
}

export interface AutoGuardInstallResult {
  created: string[];
  skipped: string[];
  clients: AutoGuardClient[];
}

const MANAGED_HEADER = "SafeFS auto-guard managed file";
const AUTO_GUARD_CLIENTS: AutoGuardClient[] = ["claude", "codex", "cursor", "gemini"];
const DEFAULT_COMMAND_SPEC: AutoGuardCommandSpec = { command: "safefs", args: [] };

export async function installAutoGuard(
  root: string,
  options: AutoGuardInstallOptions = {}
): Promise<AutoGuardInstallResult> {
  const normalizedRoot = path.resolve(root);
  const clients = uniqueClients(options.clients ?? AUTO_GUARD_CLIENTS);
  const commandSpec = options.commandSpec ?? DEFAULT_COMMAND_SPEC;
  const result: AutoGuardInstallResult = {
    created: [],
    skipped: [],
    clients,
  };

  await fs.mkdir(path.join(normalizedRoot, ".safefs", "bin"), { recursive: true });

  for (const client of clients) {
    await writeManagedFileIfMissing(
      normalizedRoot,
      path.join(".safefs", "bin", client),
      createPosixWrapper(client, commandSpec),
      result
    );
    await writeManagedFileIfMissing(
      normalizedRoot,
      path.join(".safefs", "bin", `${client}.cmd`),
      createCmdWrapper(client, commandSpec),
      result
    );
  }

  await writeManagedFileIfMissing(
    normalizedRoot,
    path.join(".safefs", "activate.ps1"),
    createPowerShellActivation(),
    result
  );
  await writeManagedFileIfMissing(
    normalizedRoot,
    path.join(".safefs", "activate.sh"),
    createShActivation(),
    result
  );

  return result;
}

export async function uninstallAutoGuard(root: string): Promise<{
  removed: string[];
  skipped: string[];
}> {
  const normalizedRoot = path.resolve(root);
  const removed: string[] = [];
  const skipped: string[] = [];
  const candidates = [
    ...AUTO_GUARD_CLIENTS.flatMap((client) => [
      path.join(".safefs", "bin", client),
      path.join(".safefs", "bin", `${client}.cmd`),
    ]),
    path.join(".safefs", "activate.ps1"),
    path.join(".safefs", "activate.sh"),
  ];

  for (const relativePath of candidates) {
    const fullPath = path.join(normalizedRoot, relativePath);
    if (!(await isManagedFile(fullPath))) {
      skipped.push(relativePath);
      continue;
    }

    await fs.unlink(fullPath);
    removed.push(relativePath);
  }

  return { removed, skipped };
}

export async function getAutoGuardStatus(
  root: string,
  clients: AutoGuardClient[] = AUTO_GUARD_CLIENTS
): Promise<AutoGuardStatus> {
  const normalizedRoot = path.resolve(root);
  const binDir = path.join(normalizedRoot, ".safefs", "bin");
  const activationFiles = await Promise.all(
    [path.join(".safefs", "activate.ps1"), path.join(".safefs", "activate.sh")].map((relativePath) =>
      getFileStatus(normalizedRoot, relativePath)
    )
  );

  return {
    binDir,
    pathActive: isPathActive(binDir),
    activationFiles,
    clients: await Promise.all(
      uniqueClients(clients).map(async (client) => ({
        client,
        wrappers: await Promise.all([
          getFileStatus(normalizedRoot, path.join(".safefs", "bin", client)),
          getFileStatus(normalizedRoot, path.join(".safefs", "bin", `${client}.cmd`)),
        ]),
        realCommand: await findRealClientCommand(client, { excludeDirs: [binDir] }),
      }))
    ),
  };
}

export function printAutoGuardStatus(status: AutoGuardStatus): void {
  console.log("SafeFS auto-guard status");
  console.log("");
  console.log(`Bin dir: ${status.binDir}`);
  console.log(`PATH active: ${status.pathActive ? "yes" : "no"}`);
  console.log(
    `Activation files: ${status.activationFiles.filter((file) => file.exists).length}/${status.activationFiles.length}`
  );

  for (const client of status.clients) {
    const wrappers = client.wrappers.filter((file) => file.exists).length;
    console.log(
      `${client.client.padEnd(8)} wrappers ${wrappers}/${client.wrappers.length} | real command: ${client.realCommand ?? "not found"}`
    );
  }
}

export function createAutoGuardEnvCommand(root: string, shell: AutoGuardShell): string {
  const binDir = path.join(path.resolve(root), ".safefs", "bin");
  switch (shell) {
    case "powershell":
      return `$env:PATH = ${JSON.stringify(binDir)} + [IO.Path]::PathSeparator + $env:PATH`;
    case "cmd":
      return `set "PATH=${binDir};%PATH%"`;
    case "bash":
    case "zsh":
      return `export PATH=${JSON.stringify(binDir)}:$PATH`;
  }
}

export async function runAutoGuard(
  root: string,
  client: AutoGuardClient,
  args: string[]
): Promise<number> {
  const normalizedRoot = path.resolve(root);
  const binDir = path.join(normalizedRoot, ".safefs", "bin");
  const command = await findRealClientCommand(client, { excludeDirs: [binDir] });
  if (!command) {
    console.error(`SafeFS auto-guard could not find the real ${client} command outside .safefs/bin.`);
    console.error(`Activate SafeFS only after installing ${client}, or run: safefs guard -- ${client}`);
    return 1;
  }

  return runGuard(normalizedRoot, [command, ...args]);
}

export async function findRealClientCommand(
  command: string,
  options: { excludeDirs?: string[]; envPath?: string } = {}
): Promise<string | undefined> {
  const envPath = options.envPath ?? process.env.PATH ?? "";
  const excludeDirs = new Set(
    (options.excludeDirs ?? []).map((dir) => normalizePathForCompare(path.resolve(dir)))
  );
  const extensions = getExecutableExtensions(command);

  for (const dir of envPath.split(path.delimiter).filter(Boolean)) {
    const resolvedDir = path.resolve(dir);
    if (excludeDirs.has(normalizePathForCompare(resolvedDir))) continue;

    for (const extension of extensions) {
      const candidate = path.join(resolvedDir, `${command}${extension}`);
      try {
        await fs.access(candidate, constants.X_OK);
        return candidate;
      } catch {
        try {
          await fs.access(candidate, constants.R_OK);
          return candidate;
        } catch {
          // keep searching
        }
      }
    }
  }

  return undefined;
}

export function isAutoGuardClient(value: string): value is AutoGuardClient {
  return (AUTO_GUARD_CLIENTS as string[]).includes(value);
}

export function getDefaultAutoGuardClients(): AutoGuardClient[] {
  return [...AUTO_GUARD_CLIENTS];
}

function createPosixWrapper(client: AutoGuardClient, spec: AutoGuardCommandSpec): string {
  const command = shellQuoteCommand(spec);
  return `#!/usr/bin/env sh
# ${MANAGED_HEADER}
exec ${command} auto-guard run ${client} -- "$@"
`;
}

function createCmdWrapper(client: AutoGuardClient, spec: AutoGuardCommandSpec): string {
  const command = cmdQuoteCommand(spec);
  return `@echo off
REM ${MANAGED_HEADER}
${command} auto-guard run ${client} -- %*
`;
}

function createPowerShellActivation(): string {
  return `# ${MANAGED_HEADER}
$SafeFsAutoGuardBin = Join-Path $PSScriptRoot "bin"
$SafeFsPathItems = ($env:PATH -split [IO.Path]::PathSeparator)
if ($SafeFsPathItems -notcontains $SafeFsAutoGuardBin) {
  $env:PATH = $SafeFsAutoGuardBin + [IO.Path]::PathSeparator + $env:PATH
}
Write-Host "SafeFS auto-guard active for this shell."
`;
}

function createShActivation(): string {
  return `# ${MANAGED_HEADER}
SAFEFS_AUTO_GUARD_BIN="$(cd ".safefs/bin" 2>/dev/null && pwd)"
if [ -n "$SAFEFS_AUTO_GUARD_BIN" ]; then
  case ":$PATH:" in
    *":$SAFEFS_AUTO_GUARD_BIN:"*) ;;
    *) PATH="$SAFEFS_AUTO_GUARD_BIN:$PATH"; export PATH ;;
  esac
  printf '%s\\n' "SafeFS auto-guard active for this shell."
else
  printf '%s\\n' "Run this from the project root after safefs init --auto-guard."
fi
`;
}

async function writeManagedFileIfMissing(
  root: string,
  relativePath: string,
  content: string,
  result: AutoGuardInstallResult
): Promise<void> {
  const fullPath = path.join(root, relativePath);
  try {
    await fs.access(fullPath);
    result.skipped.push(relativePath);
    return;
  } catch {
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, "utf-8");
    if (!relativePath.endsWith(".cmd") && !relativePath.endsWith(".ps1")) {
      try {
        await fs.chmod(fullPath, 0o755);
      } catch {
        // chmod is best-effort on Windows.
      }
    }
    result.created.push(relativePath);
  }
}

async function getFileStatus(root: string, relativePath: string): Promise<AutoGuardFileStatus> {
  const fullPath = path.join(root, relativePath);
  const managed = await isManagedFile(fullPath);
  return {
    path: relativePath,
    exists: managed || (await fileExists(fullPath)),
    managed,
  };
}

async function isManagedFile(fullPath: string): Promise<boolean> {
  try {
    const content = await fs.readFile(fullPath, "utf-8");
    return content.includes(MANAGED_HEADER);
  } catch {
    return false;
  }
}

async function fileExists(fullPath: string): Promise<boolean> {
  try {
    await fs.access(fullPath);
    return true;
  } catch {
    return false;
  }
}

function shellQuoteCommand(spec: AutoGuardCommandSpec): string {
  return [spec.command, ...spec.args].map(shellQuote).join(" ");
}

function cmdQuoteCommand(spec: AutoGuardCommandSpec): string {
  return [spec.command, ...spec.args].map(cmdQuote).join(" ");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function cmdQuote(value: string): string {
  if (/^[A-Za-z0-9_.:\/-]+$/.test(value)) return value;
  return `"${value.replace(/"/g, '""').replace(/%/g, "%%")}"`;
}

function isPathActive(binDir: string): boolean {
  const target = normalizePathForCompare(path.resolve(binDir));
  return (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .some((item) => normalizePathForCompare(path.resolve(item)) === target);
}

function getExecutableExtensions(command: string): string[] {
  if (path.extname(command)) return [""];
  if (process.platform !== "win32") return [""];
  const pathExt = process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD";
  return ["", ...pathExt.split(";").map((item) => item.toLowerCase())];
}

function normalizePathForCompare(value: string): string {
  const normalized = path.normalize(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function uniqueClients(clients: AutoGuardClient[]): AutoGuardClient[] {
  return [...new Set(clients)];
}
