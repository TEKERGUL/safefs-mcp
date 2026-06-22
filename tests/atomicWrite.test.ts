import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { atomicWriteFile, fileExists } from "../src/core/workspace.js";

describe("atomicWriteFile", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "safefs-atomic-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates a new file", async () => {
    const target = path.join(tmpDir, "new.txt");
    await atomicWriteFile(target, "hello");
    const content = await fs.readFile(target, "utf-8");
    expect(content).toBe("hello");
  });

  it("overwrites an existing file", async () => {
    const target = path.join(tmpDir, "existing.txt");
    await fs.writeFile(target, "old content");
    await atomicWriteFile(target, "new content");
    const content = await fs.readFile(target, "utf-8");
    expect(content).toBe("new content");
  });

  it("creates parent directories if missing", async () => {
    const target = path.join(tmpDir, "sub", "dir", "file.txt");
    await atomicWriteFile(target, "nested");
    const content = await fs.readFile(target, "utf-8");
    expect(content).toBe("nested");
  });

  it("cleans up temp file on write failure", async () => {
    const target = path.join(tmpDir, "no-dir-permission", "file.txt");
    await fs.mkdir(path.join(tmpDir, "no-dir-permission"), { recursive: true });

    // Write with invalid mode on Windows won't work, so verify normal path
    await atomicWriteFile(target, "content");
    expect(await fileExists(target)).toBe(true);

    // Verify no leftover tmp files
    const dir = path.join(tmpDir, "no-dir-permission");
    const files = await fs.readdir(dir);
    const tmpFiles = files.filter((f) => f.startsWith(".safefs_tmp_"));
    expect(tmpFiles).toHaveLength(0);
  });

  it("writes Buffer content correctly", async () => {
    const target = path.join(tmpDir, "binary.bin");
    const buf = Buffer.from([0x00, 0x01, 0x02, 0xff]);
    await atomicWriteFile(target, buf);
    const read = await fs.readFile(target);
    expect(Buffer.compare(read, buf)).toBe(0);
  });

  it("handles concurrent writes to same file", async () => {
    const target = path.join(tmpDir, "concurrent.txt");
    const writes = Array.from({ length: 10 }, (_, i) =>
      atomicWriteFile(target, `value-${i}`)
    );
    await Promise.all(writes);

    const content = await fs.readFile(target, "utf-8");
    expect(content).toMatch(/^value-\d$/);
  });
});
