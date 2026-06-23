import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runCheckup } from "../src/cli/checkup.js";
import { appendEvent, generateEventId } from "../src/core/timeline.js";
import { saveObject } from "../src/core/objectStore.js";
import type { TimelineEvent } from "../src/types/index.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "safefs-checkup-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeEvent(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    eventId: generateEventId(),
    timestamp: new Date().toISOString(),
    actor: "agent",
    tool: "safefs_watch",
    operation: "write",
    path: "app.ts",
    beforeHash: null,
    afterHash: "abc123",
    risk: "low",
    committed: true,
    status: "committed",
    ...overrides,
  };
}

describe("checkup", () => {
  it("reports a clean project without warnings", async () => {
    const result = await runCheckup(tmpDir);

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.storage.eventCount).toBe(0);
    expect(result.watch.binaryPolicy).toBe("skip");
  });

  it("warns when the oldest event exceeds retention threshold", async () => {
    await fs.writeFile(
      path.join(tmpDir, ".safefs.yml"),
      "storage:\n  retentionWarningDays: 1\n  retentionDays: 1\n",
      "utf-8"
    );
    await appendEvent(
      tmpDir,
      makeEvent({
        timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      })
    );

    const result = await runCheckup(tmpDir);

    expect(result.ok).toBe(false);
    expect(result.warnings.some((warning) => warning.includes("Oldest event"))).toBe(true);
    expect(result.recommendations).toContain("Preview old-event cleanup with `safefs prune --days 1`.");
  });

  it("warns when the object store exceeds configured threshold", async () => {
    await fs.writeFile(
      path.join(tmpDir, ".safefs.yml"),
      "storage:\n  maxObjectStoreBytesMB: 0.001\n",
      "utf-8"
    );
    await saveObject(tmpDir, "x".repeat(4096));

    const result = await runCheckup(tmpDir);

    expect(result.ok).toBe(false);
    expect(result.warnings.some((warning) => warning.includes("Object store"))).toBe(true);
    expect(result.recommendations).toContain(
      "Run `safefs gc --yes` to remove unreferenced objects, or prune old timeline events first."
    );
  });

  it("prints stable JSON when requested", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await runCheckup(tmpDir, { json: true });
    const printed = logSpy.mock.calls.at(-1)?.[0];

    expect(result.success).toBe(true);
    expect(typeof printed).toBe("string");
    const parsed = JSON.parse(printed as string) as { success: boolean; watch: { binaryPolicy: string } };
    expect(parsed.success).toBe(true);
    expect(parsed.watch.binaryPolicy).toBe("skip");
  });

  it("sets a non-zero exit code in strict mode when warnings exist", async () => {
    await fs.writeFile(
      path.join(tmpDir, ".safefs.yml"),
      "storage:\n  maxTimelineBytesMB: 0.001\n",
      "utf-8"
    );
    await appendEvent(tmpDir, makeEvent({ reason: "x".repeat(4096) }));

    await runCheckup(tmpDir, { strict: true });

    expect(process.exitCode).toBe(1);
  });
});
