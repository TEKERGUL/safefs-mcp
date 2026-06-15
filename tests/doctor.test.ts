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
      clients: ["codex"],
    });

    const result = await runDoctor(tmpDir);
    const requiredChecks = result.checks.filter((check) => check.status === "fail");

    expect(requiredChecks).toHaveLength(0);
    expect(result.checks.find((check) => check.name === "protection")?.status).toBe("pass");
    expect(result.checks.find((check) => check.name === "mcp-config")?.status).toBe("pass");
  });
});
