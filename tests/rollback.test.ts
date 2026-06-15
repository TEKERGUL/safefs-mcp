import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { safeWrite } from "../src/tools/safeWrite.js";
import { safePatch } from "../src/tools/safePatch.js";
import { safeDelete } from "../src/tools/safeDelete.js";
import { rollbackSince } from "../src/core/rollback.js";
import { appendEvent, generateEventId, queryEvents } from "../src/core/timeline.js";
import { DEFAULT_CONFIG } from "../src/config/defaultConfig.js";
import type { SafeFSConfig } from "../src/types/index.js";

let tmpDir: string;
let config: SafeFSConfig;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "safefs-rollback-"));
  await fs.mkdir(path.join(tmpDir, ".safefs", "timeline"), { recursive: true });
  await fs.mkdir(path.join(tmpDir, ".safefs", "objects"), { recursive: true });
  config = { ...DEFAULT_CONFIG };
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("rollback", () => {
  it("rollback last 1h restores original file", async () => {
    await fs.writeFile(path.join(tmpDir, "app.txt"), "original");

    await safeWrite({
      root: tmpDir,
      path: "app.txt",
      content: "modified by agent",
      config,
    });

    const result = await rollbackSince({
      root: tmpDir,
      since: "1h",
      dryRun: false,
      confirm: true,
      config,
    });

    expect(result.reverted).toContain("app.txt");
    const content = await fs.readFile(path.join(tmpDir, "app.txt"), "utf-8");
    expect(content).toBe("original");
  });

  it("rollback last 3h restores multiple files", async () => {
    await fs.writeFile(path.join(tmpDir, "a.txt"), "A original");
    await fs.writeFile(path.join(tmpDir, "b.txt"), "B original");

    await safeWrite({ root: tmpDir, path: "a.txt", content: "A modified", config });
    await safeWrite({ root: tmpDir, path: "b.txt", content: "B modified", config });

    const result = await rollbackSince({
      root: tmpDir,
      since: "3h",
      dryRun: false,
      confirm: true,
      config,
    });

    expect(result.reverted.sort()).toEqual(["a.txt", "b.txt"]);
    expect(await fs.readFile(path.join(tmpDir, "a.txt"), "utf-8")).toBe("A original");
    expect(await fs.readFile(path.join(tmpDir, "b.txt"), "utf-8")).toBe("B original");
  });

  it("rollback with path restores only that file", async () => {
    await fs.writeFile(path.join(tmpDir, "keep.txt"), "keep original");
    await fs.writeFile(path.join(tmpDir, "restore.txt"), "restore original");

    await safeWrite({ root: tmpDir, path: "keep.txt", content: "keep modified", config });
    await safeWrite({ root: tmpDir, path: "restore.txt", content: "restore modified", config });

    const result = await rollbackSince({
      root: tmpDir,
      since: "1h",
      path: "restore.txt",
      dryRun: false,
      confirm: true,
      config,
    });

    expect(result.reverted).toEqual(["restore.txt"]);
    expect(await fs.readFile(path.join(tmpDir, "keep.txt"), "utf-8")).toBe("keep modified");
    expect(await fs.readFile(path.join(tmpDir, "restore.txt"), "utf-8")).toBe("restore original");
  });

  it("dry-run does not modify files", async () => {
    await fs.writeFile(path.join(tmpDir, "dryrun.txt"), "original");
    await safeWrite({ root: tmpDir, path: "dryrun.txt", content: "modified", config });

    const result = await rollbackSince({
      root: tmpDir,
      since: "1h",
      dryRun: true,
      config,
    });

    expect(result.dryRun).toBe(true);
    expect(result.planned).toContain("dryrun.txt");
    expect(result.reverted).toHaveLength(0);
    expect(await fs.readFile(path.join(tmpDir, "dryrun.txt"), "utf-8")).toBe("modified");
  });

  it("rollback deleted file restores it", async () => {
    await fs.writeFile(path.join(tmpDir, "deleted.txt"), "was here");
    await safeDelete({ root: tmpDir, path: "deleted.txt", config });

    const result = await rollbackSince({
      root: tmpDir,
      since: "1h",
      dryRun: false,
      confirm: true,
      config,
    });

    expect(result.reverted).toContain("deleted.txt");
    const content = await fs.readFile(path.join(tmpDir, "deleted.txt"), "utf-8");
    expect(content).toBe("was here");
  });

  it("rollback new file deletes it if it did not exist before", async () => {
    await safeWrite({ root: tmpDir, path: "brand-new.txt", content: "created by agent", config });

    const result = await rollbackSince({
      root: tmpDir,
      since: "1h",
      dryRun: false,
      confirm: true,
      config,
    });

    expect(result.reverted).toContain("brand-new.txt");
    const exists = await fs
      .access(path.join(tmpDir, "brand-new.txt"))
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });

  it("manual post-agent edit causes conflict", async () => {
    await fs.writeFile(path.join(tmpDir, "conflict.txt"), "original");
    await safeWrite({ root: tmpDir, path: "conflict.txt", content: "agent edit", config });

    // simulate manual edit after agent
    await fs.writeFile(path.join(tmpDir, "conflict.txt"), "user manual edit");

    const result = await rollbackSince({
      root: tmpDir,
      since: "1h",
      dryRun: false,
      confirm: true,
      config,
    });

    expect(result.conflicts.length).toBe(1);
    expect(result.conflicts[0]!.path).toBe("conflict.txt");
    expect(result.reverted).not.toContain("conflict.txt");
  });

  it("conflict does not overwrite current file", async () => {
    await fs.writeFile(path.join(tmpDir, "safe.txt"), "original");
    await safeWrite({ root: tmpDir, path: "safe.txt", content: "agent", config });
    await fs.writeFile(path.join(tmpDir, "safe.txt"), "user changed");

    await rollbackSince({
      root: tmpDir,
      since: "1h",
      dryRun: false,
      confirm: true,
      config,
    });

    const content = await fs.readFile(path.join(tmpDir, "safe.txt"), "utf-8");
    expect(content).toBe("user changed");
  });

  it("rollback event is appended", async () => {
    await fs.writeFile(path.join(tmpDir, "rb.txt"), "original");
    await safeWrite({ root: tmpDir, path: "rb.txt", content: "changed", config });

    const result = await rollbackSince({
      root: tmpDir,
      since: "1h",
      dryRun: false,
      confirm: true,
      config,
    });

    expect(result.rollbackEventId).toBeTruthy();

    const events = await queryEvents(tmpDir, {});
    const rollbackEvent = events.find((e) => e.operation === "rollback");
    expect(rollbackEvent).toBeDefined();
    expect(rollbackEvent!.rollbackOf!.length).toBeGreaterThan(0);
  });

  it("latest/earliest event logic works for multiple edits to same file", async () => {
    await fs.writeFile(path.join(tmpDir, "multi.txt"), "version 0");

    await safeWrite({ root: tmpDir, path: "multi.txt", content: "version 1", config });
    await safeWrite({ root: tmpDir, path: "multi.txt", content: "version 2", config });
    await safeWrite({ root: tmpDir, path: "multi.txt", content: "version 3", config });

    const result = await rollbackSince({
      root: tmpDir,
      since: "1h",
      dryRun: false,
      confirm: true,
      config,
    });

    expect(result.reverted).toContain("multi.txt");
    const content = await fs.readFile(path.join(tmpDir, "multi.txt"), "utf-8");
    expect(content).toBe("version 0");
  });

  it("rollback rejects unsafe paths from tampered timeline events", async () => {
    await appendEvent(tmpDir, {
      eventId: generateEventId(),
      timestamp: new Date().toISOString(),
      actor: "agent",
      tool: "safe_write",
      operation: "write",
      path: ".env",
      beforeHash: null,
      afterHash: "abc",
      beforeObject: null,
      afterObject: null,
      risk: "low",
      committed: true,
      status: "committed",
    });

    await expect(
      rollbackSince({
        root: tmpDir,
        since: "1h",
        dryRun: true,
        config,
      })
    ).rejects.toThrow("protected");
  });
});
