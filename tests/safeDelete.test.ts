import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { safeDelete } from "../src/tools/safeDelete.js";
import { queryEvents } from "../src/core/timeline.js";
import { loadObject } from "../src/core/objectStore.js";
import { DEFAULT_CONFIG } from "../src/config/defaultConfig.js";
import type { SafeFSConfig } from "../src/types/index.js";

let tmpDir: string;
let config: SafeFSConfig;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "safefs-delete-"));
  await fs.mkdir(path.join(tmpDir, ".safefs", "timeline"), { recursive: true });
  await fs.mkdir(path.join(tmpDir, ".safefs", "objects"), { recursive: true });
  config = { ...DEFAULT_CONFIG };
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("safeDelete", () => {
  it("file delete works", async () => {
    await fs.writeFile(path.join(tmpDir, "target.txt"), "delete me");

    const result = await safeDelete({
      root: tmpDir,
      path: "target.txt",
      config,
    });

    expect(result.success).toBe(true);
    expect(result.operation).toBe("delete");
    expect(result.risk).toBe("high");
    expect(result.afterHash).toBeNull();

    const exists = await fs
      .access(path.join(tmpDir, "target.txt"))
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });

  it("deleted file content is stored", async () => {
    const content = "important content to preserve";
    await fs.writeFile(path.join(tmpDir, "preserve.txt"), content);

    const result = await safeDelete({
      root: tmpDir,
      path: "preserve.txt",
      config,
    });

    const events = await queryEvents(tmpDir, {});
    const event = events[0]!;
    expect(event.beforeObject).toBeTruthy();

    const restored = await loadObject(tmpDir, event.beforeObject!);
    expect(restored.toString("utf-8")).toBe(content);
  });

  it("directory delete is blocked", async () => {
    await fs.mkdir(path.join(tmpDir, "mydir"));
    await fs.writeFile(path.join(tmpDir, "mydir", "file.txt"), "x");

    await expect(
      safeDelete({
        root: tmpDir,
        path: "mydir",
        config,
      })
    ).rejects.toThrow("Directory delete is not supported");
  });

  it("protected file delete is blocked", async () => {
    await fs.writeFile(path.join(tmpDir, ".env"), "SECRET=x");

    await expect(
      safeDelete({
        root: tmpDir,
        path: ".env",
        config,
      })
    ).rejects.toThrow("protected");
  });

  it("large file delete is blocked", async () => {
    const smallConfig: SafeFSConfig = {
      ...config,
      limits: { ...config.limits, maxFileSizeMB: 0.001 },
    };
    await fs.writeFile(path.join(tmpDir, "big.txt"), "x".repeat(2000));

    await expect(
      safeDelete({
        root: tmpDir,
        path: "big.txt",
        config: smallConfig,
      })
    ).rejects.toThrow("exceeds maximum size");
  });

  it("timeline event is appended", async () => {
    await fs.writeFile(path.join(tmpDir, "tracked.txt"), "data");

    await safeDelete({
      root: tmpDir,
      path: "tracked.txt",
      reason: "cleanup",
      config,
    });

    const events = await queryEvents(tmpDir, {});
    expect(events.length).toBe(1);
    expect(events[0]!.operation).toBe("delete");
    expect(events[0]!.path).toBe("tracked.txt");
    expect(events[0]!.reason).toBe("cleanup");
    expect(events[0]!.committed).toBe(true);
  });

  it("file not found returns error", async () => {
    await expect(
      safeDelete({
        root: tmpDir,
        path: "ghost.txt",
        config,
      })
    ).rejects.toThrow("not found");
  });
});
