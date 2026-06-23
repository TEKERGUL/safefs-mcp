import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { safeDiff } from "../src/tools/safeDiff.js";
import { safeDelete } from "../src/tools/safeDelete.js";
import { safeWrite } from "../src/tools/safeWrite.js";
import { DEFAULT_CONFIG } from "../src/config/defaultConfig.js";
import type { SafeFSConfig } from "../src/types/index.js";
import { expectFirst } from "./helpers.js";

let tmpDir: string;
let config: SafeFSConfig;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "safefs-diff-"));
  await fs.mkdir(path.join(tmpDir, ".safefs", "timeline"), { recursive: true });
  await fs.mkdir(path.join(tmpDir, ".safefs", "objects"), { recursive: true });
  config = { ...DEFAULT_CONFIG };
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("safeDiff", () => {
  it("diff previews restoring an edited file", async () => {
    await fs.writeFile(path.join(tmpDir, "app.txt"), "original");
    await safeWrite({
      root: tmpDir,
      path: "app.txt",
      content: "modified",
      config,
    });

    const result = await safeDiff({ root: tmpDir, since: "1h", config });

    expect(result.diffs.length).toBe(1);
    const diff = expectFirst(result.diffs);
    expect(diff.action).toBe("restore");
    expect(diff.diff).toContain("-modified");
    expect(diff.diff).toContain("+original");
  });

  it("diff previews deleting an agent-created file", async () => {
    await safeWrite({
      root: tmpDir,
      path: "new.txt",
      content: "created",
      config,
    });

    const result = await safeDiff({ root: tmpDir, since: "1h", config });

    expect(result.diffs.length).toBe(1);
    const diff = expectFirst(result.diffs);
    expect(diff.action).toBe("delete_created");
    expect(diff.diff).toContain("+++ /dev/null");
    expect(diff.diff).toContain("-created");
  });

  it("diff previews restoring a deleted file", async () => {
    await fs.writeFile(path.join(tmpDir, "deleted.txt"), "was here");
    await safeDelete({
      root: tmpDir,
      path: "deleted.txt",
      config,
    });

    const result = await safeDiff({ root: tmpDir, since: "1h", config });

    expect(result.diffs.length).toBe(1);
    const diff = expectFirst(result.diffs);
    expect(diff.action).toBe("restore");
    expect(diff.diff).toContain("--- /dev/null");
    expect(diff.diff).toContain("+was here");
  });

  it("diff reports conflicts and skips conflicted files", async () => {
    await fs.writeFile(path.join(tmpDir, "conflict.txt"), "original");
    await safeWrite({
      root: tmpDir,
      path: "conflict.txt",
      content: "agent edit",
      config,
    });
    await fs.writeFile(path.join(tmpDir, "conflict.txt"), "user edit");

    const result = await safeDiff({ root: tmpDir, since: "1h", config });

    expect(result.diffs).toHaveLength(0);
    expect(result.conflicts).toHaveLength(1);
    expect(expectFirst(result.conflicts).path).toBe("conflict.txt");
  });
});
