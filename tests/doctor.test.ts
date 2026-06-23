import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runDoctor } from "../src/cli/doctor.js";
import { runInit } from "../src/cli/init.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "safefs-doctor-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("doctor", () => {
  it("passes required checks after init", async () => {
    await runInit(tmpDir, {
      yes: true,
      clients: ["gemini"],
    });

    const result = await runDoctor(tmpDir);
    const requiredChecks = result.checks.filter((check) => check.status === "fail");

    expect(requiredChecks).toHaveLength(0);
    expect(result.checks.find((check) => check.name === "protection")?.status).toBe("pass");
    expect(result.checks.find((check) => check.name === "mcp-config")?.status).toBe("pass");
    expect(result.checks.find((check) => check.name === "install-mode")?.status).toBe("pass");
  });

  it("recognizes local checkout mode when the generated CLI path exists", async () => {
    const cliPath = path.join(tmpDir, "dist", "cli.js");
    await fs.mkdir(path.dirname(cliPath), { recursive: true });
    await fs.writeFile(cliPath, "#!/usr/bin/env node\n", "utf-8");

    await runInit(tmpDir, {
      yes: true,
      local: true,
      localCliPath: cliPath,
      clients: ["gemini"],
    });

    const result = await runDoctor(tmpDir);
    const installMode = result.checks.find((check) => check.name === "install-mode");

    expect(result.checks.filter((check) => check.status === "fail")).toHaveLength(0);
    expect(installMode?.status).toBe("pass");
    expect(installMode?.message).toContain("local checkout");
  });

  it("reports auto-guard as active when wrappers are on PATH", async () => {
    const originalPath = process.env.PATH;
    try {
      await runInit(tmpDir, {
        yes: true,
        clients: ["claude"],
        autoGuard: true,
      });

      const safefsBin = path.join(tmpDir, ".safefs", "bin");
      const realBin = path.join(tmpDir, "real-bin");
      await fs.mkdir(realBin, { recursive: true });
      const executableName = process.platform === "win32" ? "claude.cmd" : "claude";
      const realCommand = path.join(realBin, executableName);
      await fs.writeFile(realCommand, process.platform === "win32" ? "@echo off\n" : "#!/usr/bin/env sh\n", "utf-8");
      await fs.chmod(realCommand, 0o755);
      process.env.PATH = `${safefsBin}${path.delimiter}${realBin}`;

      const result = await runDoctor(tmpDir);
      const autoGuard = result.checks.find((check) => check.name === "auto-guard");

      expect(autoGuard?.status).toBe("pass");
    } finally {
      process.env.PATH = originalPath;
    }
  });
});