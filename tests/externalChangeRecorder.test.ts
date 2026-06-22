import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { recordExternalChange, snapshotFileForExternalTracking } from "../src/core/externalChangeRecorder.js";
import { queryEvents } from "../src/core/timeline.js";
import { DEFAULT_CONFIG } from "../src/config/defaultConfig.js";

describe("externalChangeRecorder", () => {
  let tmpDir: string;
  const config = DEFAULT_CONFIG;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "safefs-ecr-"));
    await fs.mkdir(path.join(tmpDir, ".safefs", "timeline"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, ".safefs", "objects"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("records a file creation event", async () => {
    await fs.writeFile(path.join(tmpDir, "created.txt"), "hello");
    const snapshot = await snapshotFileForExternalTracking({
      root: tmpDir,
      path: "created.txt",
      config,
    });

    const result = await recordExternalChange({
      root: tmpDir,
      path: "created.txt",
      before: null,
      after: snapshot,
      tool: "test",
      config,
    });

    expect(result.recorded).toBe(true);
    expect(result.operation).toBe("write");
  });

  it("records a file deletion event", async () => {
    await fs.writeFile(path.join(tmpDir, "delete-me.txt"), "content");
    const snapshot = await snapshotFileForExternalTracking({
      root: tmpDir,
      path: "delete-me.txt",
      config,
    });

    const result = await recordExternalChange({
      root: tmpDir,
      path: "delete-me.txt",
      before: snapshot,
      after: null,
      tool: "test",
      config,
    });

    expect(result.recorded).toBe(true);
    expect(result.operation).toBe("delete");
  });

  it("does not record if hash is unchanged", async () => {
    await fs.writeFile(path.join(tmpDir, "same.txt"), "same");
    const snapshot = await snapshotFileForExternalTracking({
      root: tmpDir,
      path: "same.txt",
      config,
    });

    const result = await recordExternalChange({
      root: tmpDir,
      path: "same.txt",
      before: snapshot,
      after: snapshot,
      tool: "test",
      config,
    });

    expect(result.recorded).toBe(false);
  });

  it("deduplicates within time window", async () => {
    await fs.writeFile(path.join(tmpDir, "dedup.txt"), "v1");
    const before = await snapshotFileForExternalTracking({
      root: tmpDir,
      path: "dedup.txt",
      config,
    });

    await fs.writeFile(path.join(tmpDir, "dedup.txt"), "v2");
    const after = await snapshotFileForExternalTracking({
      root: tmpDir,
      path: "dedup.txt",
      config,
    });

    const r1 = await recordExternalChange({
      root: tmpDir,
      path: "dedup.txt",
      before,
      after,
      tool: "test",
      config,
    });
    expect(r1.recorded).toBe(true);

    const r2 = await recordExternalChange({
      root: tmpDir,
      path: "dedup.txt",
      before,
      after,
      tool: "test",
      config,
    });
    expect(r2.recorded).toBe(false);
    expect(r2.reason).toContain("Recent equivalent");
  });

  it("handles concurrent calls for different paths", async () => {
    await fs.writeFile(path.join(tmpDir, "a.txt"), "a");
    await fs.writeFile(path.join(tmpDir, "b.txt"), "b");

    const snapA = await snapshotFileForExternalTracking({
      root: tmpDir,
      path: "a.txt",
      config,
    });
    const snapB = await snapshotFileForExternalTracking({
      root: tmpDir,
      path: "b.txt",
      config,
    });

    const [ra, rb] = await Promise.all([
      recordExternalChange({
        root: tmpDir,
        path: "a.txt",
        before: null,
        after: snapA,
        tool: "test",
        config,
      }),
      recordExternalChange({
        root: tmpDir,
        path: "b.txt",
        before: null,
        after: snapB,
        tool: "test",
        config,
      }),
    ]);

    expect(ra.recorded).toBe(true);
    expect(rb.recorded).toBe(true);

    const events = await queryEvents(tmpDir, {});
    const committed = events.filter((e) => e.committed);
    expect(committed.length).toBe(2);
  });
});
