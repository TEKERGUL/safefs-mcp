import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { collectGarbage } from "../src/core/objectGC.js";
import { saveObject } from "../src/core/objectStore.js";
import { appendEvent, generateEventId } from "../src/core/timeline.js";
import type { TimelineEvent } from "../src/types/index.js";

describe("objectGC", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "safefs-gc-"));
    await fs.mkdir(path.join(tmpDir, ".safefs", "timeline"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, ".safefs", "objects"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("removes unreferenced objects", async () => {
    await saveObject(tmpDir, "orphan content");
    const result = await collectGarbage(tmpDir, { graceMs: 0 });
    expect(result.deleted).toBe(1);
    expect(result.freedBytes).toBeGreaterThan(0);
    expect(result.retained).toBe(0);
  });

  it("preserves referenced objects", async () => {
    const hash = await saveObject(tmpDir, "keep me");

    const event: TimelineEvent = {
      eventId: generateEventId(),
      timestamp: new Date().toISOString(),
      actor: "agent",
      tool: "test",
      operation: "write",
      path: "file.txt",
      afterObject: hash,
      afterHash: hash,
      risk: "low",
      committed: true,
      status: "committed",
    };
    await appendEvent(tmpDir, event);

    const result = await collectGarbage(tmpDir, { graceMs: 0 });
    expect(result.deleted).toBe(0);
    expect(result.retained).toBe(1);
  });

  it("handles empty object store", async () => {
    const result = await collectGarbage(tmpDir, { graceMs: 0 });
    expect(result.deleted).toBe(0);
    expect(result.retained).toBe(0);
    expect(result.freedBytes).toBe(0);
  });

  it("handles mixed referenced and unreferenced", async () => {
    const refHash = await saveObject(tmpDir, "referenced");
    await saveObject(tmpDir, "orphan");

    const event: TimelineEvent = {
      eventId: generateEventId(),
      timestamp: new Date().toISOString(),
      actor: "agent",
      tool: "test",
      operation: "write",
      path: "file.txt",
      beforeObject: refHash,
      beforeHash: refHash,
      risk: "low",
      committed: true,
      status: "committed",
    };
    await appendEvent(tmpDir, event);

    const result = await collectGarbage(tmpDir, { graceMs: 0 });
    expect(result.deleted).toBe(1);
    expect(result.retained).toBe(1);
  });

  it("dry-run reports unreferenced objects without deleting them", async () => {
    const hash = await saveObject(tmpDir, "dry run orphan");

    const result = await collectGarbage(tmpDir, { dryRun: true, graceMs: 0 });
    expect(result.deleted).toBe(1);
    expect(result.dryRun).toBe(true);

    const objectPath = path.join(tmpDir, ".safefs", "objects", hash.slice(0, 2), hash);
    await expect(fs.stat(objectPath)).resolves.toBeTruthy();
  });

  it("skips young unreferenced objects by default", async () => {
    await saveObject(tmpDir, "recent orphan");

    const result = await collectGarbage(tmpDir);
    expect(result.deleted).toBe(0);
    expect(result.skippedYoung).toBe(1);
    expect(result.retained).toBe(1);
  });
});
