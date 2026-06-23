import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  calculateLegacySuppressionTtlMs,
  calculateRollbackSuppressionTtlMs,
  createSuppression,
  isPathSuppressed,
} from "../src/core/suppression.js";
import { DEFAULT_CONFIG } from "../src/config/defaultConfig.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "safefs-suppression-"));
});

afterEach(async () => {
  vi.useRealTimers();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("suppression", () => {
  it("sizes legacy write TTL from watch interval and debounce", () => {
    expect(calculateLegacySuppressionTtlMs(DEFAULT_CONFIG)).toBe(2750);
  });

  it("keeps a minimum legacy TTL for fast polling configs", () => {
    const config = {
      ...DEFAULT_CONFIG,
      watch: {
        ...DEFAULT_CONFIG.watch,
        intervalMs: 100,
        debounceMs: 0,
      },
    };

    expect(calculateLegacySuppressionTtlMs(config)).toBe(2500);
  });

  it("scales rollback TTL by number of affected paths", () => {
    expect(calculateRollbackSuppressionTtlMs(DEFAULT_CONFIG, 1)).toBe(5000);
    expect(calculateRollbackSuppressionTtlMs(DEFAULT_CONFIG, 200)).toBe(12750);
  });

  it("keeps suppression active until TTL expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-23T10:00:00.000Z"));

    await createSuppression({
      root: tmpDir,
      paths: ["src/index.ts"],
      reason: "safe_write",
      ttlMs: 1000,
    });

    expect(await isPathSuppressed(tmpDir, "src/index.ts")).toBe(true);

    vi.advanceTimersByTime(999);
    expect(await isPathSuppressed(tmpDir, "src/index.ts")).toBe(true);

    vi.advanceTimersByTime(2);
    expect(await isPathSuppressed(tmpDir, "src/index.ts")).toBe(false);
  });

  it("does not suppress unrelated paths", async () => {
    await createSuppression({
      root: tmpDir,
      paths: ["src/index.ts"],
      reason: "safe_write",
      ttlMs: 1000,
    });

    expect(await isPathSuppressed(tmpDir, "src/other.ts")).toBe(false);
  });
});
