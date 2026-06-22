import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { pruneTimeline } from "../src/core/timelinePruning.js";
import { appendEvent, generateEventId, queryEvents } from "../src/core/timeline.js";
import type { TimelineEvent } from "../src/types/index.js";

function makeEvent(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    eventId: generateEventId(),
    timestamp: new Date().toISOString(),
    actor: "agent",
    tool: "test",
    operation: "write",
    path: "test.txt",
    risk: "low",
    committed: true,
    status: "committed",
    ...overrides,
  };
}

describe("timelinePruning", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "safefs-prune-"));
    await fs.mkdir(path.join(tmpDir, ".safefs", "timeline"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("prunes events older than retention days", async () => {
    const oldTime = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const recentTime = new Date(Date.now() - 1 * 86_400_000).toISOString();

    await appendEvent(tmpDir, makeEvent({ timestamp: oldTime }));
    await appendEvent(tmpDir, makeEvent({ timestamp: oldTime }));
    await appendEvent(tmpDir, makeEvent({ timestamp: recentTime }));

    const result = await pruneTimeline(tmpDir, { retentionDays: 30 });
    expect(result.pruned).toBe(2);
    expect(result.retained).toBe(1);

    const events = await queryEvents(tmpDir, {});
    expect(events).toHaveLength(1);
  });

  it("dry-run reports old events without rewriting the timeline", async () => {
    const oldTime = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const recentTime = new Date(Date.now() - 1 * 86_400_000).toISOString();

    await appendEvent(tmpDir, makeEvent({ timestamp: oldTime }));
    await appendEvent(tmpDir, makeEvent({ timestamp: recentTime }));

    const result = await pruneTimeline(tmpDir, { retentionDays: 30, dryRun: true });
    expect(result.pruned).toBe(1);
    expect(result.retained).toBe(1);
    expect(result.dryRun).toBe(true);

    const events = await queryEvents(tmpDir, {});
    expect(events).toHaveLength(2);
  });

  it("is a no-op when no events are older than retention", async () => {
    const recent = new Date(Date.now() - 1000).toISOString();
    await appendEvent(tmpDir, makeEvent({ timestamp: recent }));

    const result = await pruneTimeline(tmpDir, { retentionDays: 30 });
    expect(result.pruned).toBe(0);
    expect(result.retained).toBe(1);
  });

  it("handles empty timeline", async () => {
    const result = await pruneTimeline(tmpDir, { retentionDays: 30 });
    expect(result.pruned).toBe(0);
    expect(result.retained).toBe(0);
  });

  it("preserves event ordering after prune", async () => {
    const t1 = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const t2 = new Date(Date.now() - 1 * 86_400_000).toISOString();

    await appendEvent(tmpDir, makeEvent({ timestamp: t1, path: "first.txt" }));
    await appendEvent(tmpDir, makeEvent({ timestamp: t2, path: "second.txt" }));

    await pruneTimeline(tmpDir, { retentionDays: 3 });

    const events = await queryEvents(tmpDir, {});
    expect(events).toHaveLength(2);
    expect(events[0]!.path).toBe("first.txt");
    expect(events[1]!.path).toBe("second.txt");
  });
});
