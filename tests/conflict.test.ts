import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { detectConflict } from "../src/core/conflict.js";
import { sha256Buffer } from "../src/core/hash.js";
import type { TimelineEvent } from "../src/types/index.js";
import { expectDefined } from "./helpers.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "safefs-conflict-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeEvent(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    eventId: "evt_test123",
    timestamp: new Date().toISOString(),
    actor: "agent",
    tool: "safe_write",
    operation: "write",
    path: "test.txt",
    beforeHash: null,
    afterHash: null,
    risk: "medium",
    committed: true,
    ...overrides,
  };
}

describe("conflict detection", () => {
  it("no conflict when file matches expected hash", async () => {
    const content = "expected content";
    const hash = sha256Buffer(Buffer.from(content));
    const filePath = path.join(tmpDir, "ok.txt");
    await fs.writeFile(filePath, content);

    const result = await detectConflict(
      filePath,
      makeEvent({ afterHash: hash, path: "ok.txt" })
    );
    expect(result).toBeNull();
  });

  it("conflict when file has different content", async () => {
    const filePath = path.join(tmpDir, "changed.txt");
    await fs.writeFile(filePath, "user-modified content");

    const result = await detectConflict(
      filePath,
      makeEvent({ afterHash: "expected_hash_different", path: "changed.txt" })
    );
    expect(expectDefined(result).reason).toContain("modified after");
  });

  it("no conflict when deleted file stays deleted", async () => {
    const filePath = path.join(tmpDir, "gone.txt");

    const result = await detectConflict(
      filePath,
      makeEvent({ operation: "delete", afterHash: null, path: "gone.txt" })
    );
    expect(result).toBeNull();
  });

  it("conflict when deleted file reappears", async () => {
    const filePath = path.join(tmpDir, "back.txt");
    await fs.writeFile(filePath, "I'm back");

    const result = await detectConflict(
      filePath,
      makeEvent({ operation: "delete", afterHash: null, path: "back.txt" })
    );
    expect(expectDefined(result).reason).toContain("recreated");
  });
});
