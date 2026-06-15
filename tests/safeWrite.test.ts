import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { safeWrite } from "../src/tools/safeWrite.js";
import { queryEvents } from "../src/core/timeline.js";
import { loadObject } from "../src/core/objectStore.js";
import { DEFAULT_CONFIG } from "../src/config/defaultConfig.js";
import type { SafeFSConfig } from "../src/types/index.js";

let tmpDir: string;
let config: SafeFSConfig;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "safefs-write-"));
  await fs.mkdir(path.join(tmpDir, ".safefs", "timeline"), { recursive: true });
  await fs.mkdir(path.join(tmpDir, ".safefs", "objects"), { recursive: true });
  config = { ...DEFAULT_CONFIG };
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("safeWrite", () => {
  it("new file write works", async () => {
    const result = await safeWrite({
      root: tmpDir,
      path: "hello.txt",
      content: "hello world",
      config,
    });

    expect(result.success).toBe(true);
    expect(result.operation).toBe("write");
    expect(result.beforeHash).toBeNull();
    expect(result.afterHash).toBeTruthy();
    expect(result.risk).toBe("low");

    const written = await fs.readFile(path.join(tmpDir, "hello.txt"), "utf-8");
    expect(written).toBe("hello world");
  });

  it("existing file write stores beforeObject", async () => {
    const filePath = path.join(tmpDir, "existing.txt");
    await fs.writeFile(filePath, "original content");

    const result = await safeWrite({
      root: tmpDir,
      path: "existing.txt",
      content: "new content",
      config,
    });

    expect(result.success).toBe(true);
    expect(result.beforeHash).toBeTruthy();
    expect(result.risk).toBe("medium");

    const events = await queryEvents(tmpDir, {});
    const event = events[0]!;
    expect(event.beforeObject).toBeTruthy();

    const restored = await loadObject(tmpDir, event.beforeObject!);
    expect(restored.toString("utf-8")).toBe("original content");
  });

  it("timeline event is appended", async () => {
    await safeWrite({
      root: tmpDir,
      path: "tracked.txt",
      content: "tracked content",
      reason: "test write",
      config,
    });

    const events = await queryEvents(tmpDir, {});
    expect(events.length).toBe(1);
    expect(events[0]!.operation).toBe("write");
    expect(events[0]!.path).toBe("tracked.txt");
    expect(events[0]!.reason).toBe("test write");
    expect(events[0]!.committed).toBe(true);
  });

  it("protected file write is blocked", async () => {
    await expect(
      safeWrite({
        root: tmpDir,
        path: ".env",
        content: "SECRET=bad",
        config,
      })
    ).rejects.toThrow("protected");
  });

  it("large file write is blocked", async () => {
    const smallConfig: SafeFSConfig = {
      ...config,
      limits: { ...config.limits, maxFileSizeMB: 0.001 },
    };

    await expect(
      safeWrite({
        root: tmpDir,
        path: "big.txt",
        content: "x".repeat(2000),
        config: smallConfig,
      })
    ).rejects.toThrow("exceeds maximum size");
  });

  it("creates parent directories if needed", async () => {
    const result = await safeWrite({
      root: tmpDir,
      path: "deep/nested/dir/file.txt",
      content: "nested",
      config,
    });

    expect(result.success).toBe(true);
    const written = await fs.readFile(
      path.join(tmpDir, "deep/nested/dir/file.txt"),
      "utf-8"
    );
    expect(written).toBe("nested");
  });
});
