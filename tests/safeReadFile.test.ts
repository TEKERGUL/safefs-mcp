import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { safeReadFile } from "../src/tools/safeReadFile.js";
import { loadConfig } from "../src/config/loadConfig.js";
import type { SafeFSConfig } from "../src/types/index.js";

describe("safeReadFile", () => {
  let tmpDir: string;
  let config: SafeFSConfig;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "safefs-read-test-"));
    const configDir = path.join(tmpDir, ".safefs");
    await fs.mkdir(configDir);
    config = await loadConfig(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("should read a valid file inside the workspace", async () => {
    const testFile = path.join(tmpDir, "test.txt");
    await fs.writeFile(testFile, "hello world");
    const result = await safeReadFile(tmpDir, "test.txt", config);
    expect(result.content).toBe("hello world");
  });

  it("should throw an error for path traversal", async () => {
    await expect(safeReadFile(tmpDir, "../outside.txt", config)).rejects.toThrow("outside workspace");
  });

  it("should throw an error for accessing .safefs", async () => {
    await expect(safeReadFile(tmpDir, ".safefs/config.yml", config)).rejects.toThrow(".safefs/ internals");
  });

  it("should throw an error if file does not exist", async () => {
    await expect(safeReadFile(tmpDir, "nonexistent.txt", config)).rejects.toThrow();
  });
});
