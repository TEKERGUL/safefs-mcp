import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DEFAULT_CONFIG } from "../src/config/defaultConfig.js";
import { runGuard } from "../src/cli/guard.js";
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
  it("records native file edits after stable debounce and rollback restores content", async () => {
    const filePath = path.join(tmpDir, "index.html");
    await fs.writeFile(filePath, "<h1>Clean</h1>\n", "utf-8");

    const baseline = await scanWorkspaceForWatch({ root: tmpDir, config: DEFAULT_CONFIG });
    await fs.writeFile(filePath, "<h1>Broken</h1>\n", "utf-8");

    const pending = await detectWorkspaceChanges({
      root: tmpDir,
      config: DEFAULT_CONFIG,
      previous: baseline.snapshot,
      nowMs: 1000,
    });
    expect(pending.events).toHaveLength(0);
    expect(pending.pending.size).toBe(1);

    const cycle = await detectWorkspaceChanges({
      root: tmpDir,
      config: DEFAULT_CONFIG,
      previous: baseline.snapshot,
      pending: pending.pending,
      nowMs: 2000,
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

    const baseline = await scanWorkspaceForWatch({ root: tmpDir, config: DEFAULT_CONFIG });
    await fs.unlink(filePath);

    const cycle = await detectWorkspaceChanges({
      root: tmpDir,
      config: DEFAULT_CONFIG,
      previous: baseline.snapshot,
      stableMs: 0,
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

    const baseline = await scanWorkspaceForWatch({ root: tmpDir, config: DEFAULT_CONFIG });

    expect(baseline.snapshot.has(".env")).toBe(false);
  });

  it("respects .gitignore and skips binary and large files", async () => {
    const config = {
      ...DEFAULT_CONFIG,
      watch: {
        ...DEFAULT_CONFIG.watch,
        maxFileSizeMB: 0.001,
      },
    };
    await fs.writeFile(path.join(tmpDir, ".gitignore"), "ignored.txt\n", "utf-8");
    await fs.writeFile(path.join(tmpDir, "ignored.txt"), "ignored\n", "utf-8");
    await fs.writeFile(path.join(tmpDir, "binary.bin"), Buffer.from([0, 1, 2, 3]));
    await fs.writeFile(path.join(tmpDir, "large.txt"), "x".repeat(4096), "utf-8");

    const baseline = await scanWorkspaceForWatch({ root: tmpDir, config });

    expect(baseline.snapshot.has("ignored.txt")).toBe(false);
    expect(baseline.snapshot.has("binary.bin")).toBe(false);
    expect(baseline.snapshot.has("large.txt")).toBe(false);
    expect(baseline.skippedDetails.map((item) => item.reason)).toContain("binary_file_skipped");
    expect(baseline.skippedDetails.map((item) => item.reason)).toContain("too-large");
  });

  it("suppresses watcher events caused by rollback", async () => {
    const filePath = path.join(tmpDir, "app.ts");
    await fs.writeFile(filePath, "clean\n", "utf-8");
    const baseline = await scanWorkspaceForWatch({ root: tmpDir, config: DEFAULT_CONFIG });

    await fs.writeFile(filePath, "broken\n", "utf-8");
    const changed = await detectWorkspaceChanges({
      root: tmpDir,
      config: DEFAULT_CONFIG,
      previous: baseline.snapshot,
      stableMs: 0,
    });
    expect(changed.events).toHaveLength(1);

    await rollbackSince({
      root: tmpDir,
      since: "1h",
      dryRun: false,
      confirm: true,
      config: DEFAULT_CONFIG,
    });

    const afterRollback = await detectWorkspaceChanges({
      root: tmpDir,
      config: DEFAULT_CONFIG,
      previous: changed.snapshot,
      stableMs: 0,
    });
    expect(afterRollback.events).toHaveLength(0);
    await expect(fs.readFile(filePath, "utf-8")).resolves.toBe("clean\n");
  });

  it("detects same-hash move and rollback moves the file back", async () => {
    const oldPath = path.join(tmpDir, "old.txt");
    const newPath = path.join(tmpDir, "new.txt");
    await fs.writeFile(oldPath, "same content\n", "utf-8");
    const baseline = await scanWorkspaceForWatch({ root: tmpDir, config: DEFAULT_CONFIG });

    await fs.rename(oldPath, newPath);
    const moved = await detectWorkspaceChanges({
      root: tmpDir,
      config: DEFAULT_CONFIG,
      previous: baseline.snapshot,
      stableMs: 0,
    });

    expect(moved.events).toHaveLength(1);
    expect(moved.events[0]!.operation).toBe("move");

    await rollbackSince({
      root: tmpDir,
      since: "1h",
      dryRun: false,
      confirm: true,
      config: DEFAULT_CONFIG,
    });

    await expect(fs.readFile(oldPath, "utf-8")).resolves.toBe("same content\n");
    await expect(fs.stat(newPath)).rejects.toThrow();
  });

  it("guard captures native writes from a child command", async () => {
    const exitCode = await runGuard(tmpDir, [
      "node",
      "-e",
      "require('fs').writeFileSync('guard.txt', 'changed\\n')",
    ]);

    expect(exitCode).toBe(0);
    await expect(fs.readFile(path.join(tmpDir, "guard.txt"), "utf-8")).resolves.toBe("changed\n");

    await rollbackSince({
      root: tmpDir,
      since: "1h",
      dryRun: false,
      confirm: true,
      config: DEFAULT_CONFIG,
    });

    await expect(fs.stat(path.join(tmpDir, "guard.txt"))).rejects.toThrow();
  });
});