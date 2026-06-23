import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { safeDelete } from "../src/tools/safeDelete.js";
import { safeRestoreFile } from "../src/tools/safeRestoreFile.js";
import { safeWrite } from "../src/tools/safeWrite.js";
import { queryEvents } from "../src/core/timeline.js";
import { DEFAULT_CONFIG } from "../src/config/defaultConfig.js";
import type { SafeFSConfig } from "../src/types/index.js";

let tmpDir: string;
let config: SafeFSConfig;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "safefs-restore-file-"));
  await fs.mkdir(path.join(tmpDir, ".safefs", "timeline"), { recursive: true });
  await fs.mkdir(path.join(tmpDir, ".safefs", "objects"), { recursive: true });
  config = { ...DEFAULT_CONFIG };
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("safeRestoreFile", () => {
  it("restores only one damaged file from its latest checkpoint", async () => {
    await fs.writeFile(path.join(tmpDir, "keep.txt"), "keep original", "utf-8");
    await fs.writeFile(path.join(tmpDir, "restore.txt"), "restore original", "utf-8");
    await safeWrite({ root: tmpDir, path: "keep.txt", content: "keep good", config });
    await safeWrite({ root: tmpDir, path: "restore.txt", content: "restore bad", config });

    const dryRun = await safeRestoreFile({
      root: tmpDir,
      path: "restore.txt",
      dryRun: true,
      config,
    });

    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.action).toBe("restore");
    await expect(fs.readFile(path.join(tmpDir, "restore.txt"), "utf-8")).resolves.toBe("restore bad");

    const applied = await safeRestoreFile({
      root: tmpDir,
      path: "restore.txt",
      dryRun: false,
      confirm: true,
      config,
    });

    expect(applied.applied).toBe(true);
    expect(await fs.readFile(path.join(tmpDir, "restore.txt"), "utf-8")).toBe("restore original");
    expect(await fs.readFile(path.join(tmpDir, "keep.txt"), "utf-8")).toBe("keep good");
  });

  it("can restore from a specific checkpoint id", async () => {
    await fs.writeFile(path.join(tmpDir, "multi.txt"), "version 0", "utf-8");
    const first = await safeWrite({ root: tmpDir, path: "multi.txt", content: "version 1", config });
    await safeWrite({ root: tmpDir, path: "multi.txt", content: "version 2", config });

    const result = await safeRestoreFile({
      root: tmpDir,
      path: "multi.txt",
      checkpointId: first.eventId,
      dryRun: false,
      confirm: true,
      config,
    });

    expect(result.checkpointId).toBe(first.eventId);
    expect(result.rollbackOf.length).toBeGreaterThanOrEqual(2);
    expect(await fs.readFile(path.join(tmpDir, "multi.txt"), "utf-8")).toBe("version 0");
  });

  it("deletes a file that was created by the selected checkpoint", async () => {
    await safeWrite({ root: tmpDir, path: "created.txt", content: "new file", config });

    const result = await safeRestoreFile({
      root: tmpDir,
      path: "created.txt",
      dryRun: false,
      confirm: true,
      config,
    });

    expect(result.action).toBe("delete_created_file");
    expect(result.deleted).toBe(true);
    await expect(fs.stat(path.join(tmpDir, "created.txt"))).rejects.toThrow();
  });

  it("restores a file that was deleted by the selected checkpoint", async () => {
    await fs.writeFile(path.join(tmpDir, "deleted.txt"), "important", "utf-8");
    await safeDelete({ root: tmpDir, path: "deleted.txt", config });

    const result = await safeRestoreFile({
      root: tmpDir,
      path: "deleted.txt",
      dryRun: false,
      confirm: true,
      config,
    });

    expect(result.action).toBe("restore");
    expect(result.applied).toBe(true);
    await expect(fs.readFile(path.join(tmpDir, "deleted.txt"), "utf-8")).resolves.toBe("important");
  });

  it("does not overwrite a file that changed after the latest checkpoint", async () => {
    await fs.writeFile(path.join(tmpDir, "conflict.txt"), "original", "utf-8");
    await safeWrite({ root: tmpDir, path: "conflict.txt", content: "agent edit", config });
    await fs.writeFile(path.join(tmpDir, "conflict.txt"), "manual edit", "utf-8");

    const result = await safeRestoreFile({
      root: tmpDir,
      path: "conflict.txt",
      dryRun: false,
      confirm: true,
      config,
    });

    expect(result.conflicts).toHaveLength(1);
    expect(result.applied).toBe(false);
    await expect(fs.readFile(path.join(tmpDir, "conflict.txt"), "utf-8")).resolves.toBe("manual edit");
  });

  it("appends a rollback event after applying restore", async () => {
    await fs.writeFile(path.join(tmpDir, "tracked.txt"), "before", "utf-8");
    await safeWrite({ root: tmpDir, path: "tracked.txt", content: "after", config });

    const result = await safeRestoreFile({
      root: tmpDir,
      path: "tracked.txt",
      dryRun: false,
      confirm: true,
      config,
    });
    const events = await queryEvents(tmpDir, {});

    expect(result.rollbackEventId).toBeTruthy();
    expect(events.some((event) => event.tool === "safe_restore_file" && event.operation === "rollback")).toBe(true);
  });
});
