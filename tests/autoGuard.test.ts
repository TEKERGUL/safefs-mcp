import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createAutoGuardEnvCommand,
  findRealClientCommand,
  getAutoGuardStatus,
  installAutoGuard,
  uninstallAutoGuard,
} from "../src/cli/autoGuard.js";

let tmpDir: string;
let originalPath: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "safefs-auto-guard-"));
  originalPath = process.env.PATH;
});

afterEach(async () => {
  process.env.PATH = originalPath;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("auto-guard", () => {
  it("installs project-local wrappers and activation files", async () => {
    const result = await installAutoGuard(tmpDir, { clients: ["claude"] });

    expect(result.created).toContain(path.join(".safefs", "bin", "claude"));
    expect(result.created).toContain(path.join(".safefs", "bin", "claude.cmd"));
    expect(result.created).toContain(path.join(".safefs", "activate.ps1"));
    expect(result.created).toContain(path.join(".safefs", "activate.sh"));

    const wrapper = await fs.readFile(path.join(tmpDir, ".safefs", "bin", "claude"), "utf-8");
    const cmdWrapper = await fs.readFile(path.join(tmpDir, ".safefs", "bin", "claude.cmd"), "utf-8");
    expect(wrapper).toContain("auto-guard run claude --");
    expect(cmdWrapper).toContain("auto-guard run claude --");
  });

  it("does not overwrite existing wrapper files", async () => {
    const wrapperPath = path.join(tmpDir, ".safefs", "bin", "claude");
    await fs.mkdir(path.dirname(wrapperPath), { recursive: true });
    await fs.writeFile(wrapperPath, "custom", "utf-8");

    const result = await installAutoGuard(tmpDir, { clients: ["claude"] });

    expect(result.skipped).toContain(path.join(".safefs", "bin", "claude"));
    await expect(fs.readFile(wrapperPath, "utf-8")).resolves.toBe("custom");
  });

  it("finds the real client command outside .safefs/bin", async () => {
    const safefsBin = path.join(tmpDir, ".safefs", "bin");
    const realBin = path.join(tmpDir, "real-bin");
    await fs.mkdir(safefsBin, { recursive: true });
    await fs.mkdir(realBin, { recursive: true });

    const executableName = process.platform === "win32" ? "claude.cmd" : "claude";
    await fs.writeFile(path.join(safefsBin, executableName), "safe wrapper", "utf-8");
    const realCommand = path.join(realBin, executableName);
    await fs.writeFile(realCommand, process.platform === "win32" ? "@echo off\n" : "#!/usr/bin/env sh\n", "utf-8");
    await fs.chmod(realCommand, 0o755);

    const found = await findRealClientCommand("claude", {
      envPath: `${safefsBin}${path.delimiter}${realBin}`,
      excludeDirs: [safefsBin],
    });

    expect(found).toBe(realCommand);
  });

  it("reports active status when wrappers and real command are available", async () => {
    await installAutoGuard(tmpDir, { clients: ["claude"] });
    const safefsBin = path.join(tmpDir, ".safefs", "bin");
    const realBin = path.join(tmpDir, "real-bin");
    await fs.mkdir(realBin, { recursive: true });
    const executableName = process.platform === "win32" ? "claude.cmd" : "claude";
    const realCommand = path.join(realBin, executableName);
    await fs.writeFile(realCommand, process.platform === "win32" ? "@echo off\n" : "#!/usr/bin/env sh\n", "utf-8");
    await fs.chmod(realCommand, 0o755);
    process.env.PATH = `${safefsBin}${path.delimiter}${realBin}`;

    const status = await getAutoGuardStatus(tmpDir, ["claude"]);

    expect(status.pathActive).toBe(true);
    expect(status.clients[0]!.realCommand).toBe(realCommand);
    expect(status.clients[0]!.wrappers.every((wrapper) => wrapper.exists)).toBe(true);
  });

  it("uninstalls only managed files", async () => {
    await installAutoGuard(tmpDir, { clients: ["claude"] });
    const unmanaged = path.join(tmpDir, ".safefs", "bin", "codex");
    await fs.writeFile(unmanaged, "custom", "utf-8");

    const result = await uninstallAutoGuard(tmpDir);

    expect(result.removed).toContain(path.join(".safefs", "bin", "claude"));
    await expect(fs.stat(unmanaged)).resolves.toBeTruthy();
  });

  it("prints shell activation commands", () => {
    expect(createAutoGuardEnvCommand(tmpDir, "powershell")).toContain(".safefs");
    expect(createAutoGuardEnvCommand(tmpDir, "bash")).toContain("export PATH=");
  });
});
