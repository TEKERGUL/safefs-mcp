import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DEFAULT_CONFIG } from "../src/config/defaultConfig.js";
import { rollbackSince } from "../src/core/rollback.js";
import { detectWorkspaceChanges, scanWorkspaceForWatch } from "../src/core/watch.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "safefs-watch-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("watch", () => {
  it("records native file edits and rollback restores the previous content", async () => {
    const filePath = path.join(tmpDir, "index.html");
    await fs.writeFile(filePath, "<h1>Clean</h1>\n", "utf-8");

    const baseline = await scanWorkspaceForWatch({
      root: tmpDir,
      config: DEFAULT_CONFIG,
    });

    await fs.writeFile(filePath, "<h1>Broken</h1>\n", "utf-8");

    const cycle = await detectWorkspaceChanges({
      root: tmpDir,
      config: DEFAULT_CONFIG,
      previous: baseline.snapshot,
    });

    expect(cycle.events).toHaveLength(1);
    expect(cycle.events[0]!.path).toBe("index.html");
    expect(cycle.events[0]!.operation).toBe("write");

    await rollbackSince({
      root: tmpDir,
      since: "1h",
      dryRun: false,
      confirm: true,
      config: DEFAULT_CONFIG,
    });

    await expect(fs.readFile(filePath, "utf-8")).resolves.toBe("<h1>Clean</h1>\n");
  });

  it("records native file deletion and rollback restores the deleted file", async () => {
    const filePath = path.join(tmpDir, "notes.txt");
    await fs.writeFile(filePath, "keep me\n", "utf-8");

    const baseline = await scanWorkspaceForWatch({
      root: tmpDir,
      config: DEFAULT_CONFIG,
    });

    await fs.unlink(filePath);

    const cycle = await detectWorkspaceChanges({
      root: tmpDir,
      config: DEFAULT_CONFIG,
      previous: baseline.snapshot,
    });

    expect(cycle.events).toHaveLength(1);
    expect(cycle.events[0]!.operation).toBe("delete");

    await rollbackSince({
      root: tmpDir,
      since: "1h",
      dryRun: false,
      confirm: true,
      config: DEFAULT_CONFIG,
    });

    await expect(fs.readFile(filePath, "utf-8")).resolves.toBe("keep me\n");
  });

  it("does not track mandatory protected files", async () => {
    await fs.writeFile(path.join(tmpDir, ".env"), "TOKEN=secret\n", "utf-8");

    const baseline = await scanWorkspaceForWatch({
      root: tmpDir,
      config: DEFAULT_CONFIG,
    });

    expect(baseline.snapshot.has(".env")).toBe(false);
  });
});
