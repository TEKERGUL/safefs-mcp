import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DEFAULT_CONFIG } from "../src/config/defaultConfig.js";
import { runGuard } from "../src/cli/guard.js";
import { rollbackSince } from "../src/core/rollback.js";
import { queryEvents } from "../src/core/timeline.js";
import { detectWorkspaceChanges, scanWorkspaceForWatch } from "../src/core/watch.js";
import { safeDelete } from "../src/tools/safeDelete.js";
import { safePatch } from "../src/tools/safePatch.js";
import { safeWrite } from "../src/tools/safeWrite.js";

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
    const config = {
      ...DEFAULT_CONFIG,
      watch: { ...DEFAULT_CONFIG.watch, moveDetectionWindowMs: 0 },
    };

    const baseline = await scanWorkspaceForWatch({ root: tmpDir, config });
    await fs.unlink(filePath);

    const cycle = await detectWorkspaceChanges({
      root: tmpDir,
      config,
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
      config,
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

  it("defers stable changes beyond the configured per-cycle limit", async () => {
    const config = {
      ...DEFAULT_CONFIG,
      watch: {
        ...DEFAULT_CONFIG.watch,
        maxEventsPerCycle: 1,
        maxPendingChangesWarning: 2,
      },
    };
    const baseline = await scanWorkspaceForWatch({ root: tmpDir, config });
    await fs.writeFile(path.join(tmpDir, "a.txt"), "a", "utf-8");
    await fs.writeFile(path.join(tmpDir, "b.txt"), "b", "utf-8");
    await fs.writeFile(path.join(tmpDir, "c.txt"), "c", "utf-8");

    const firstCycle = await detectWorkspaceChanges({
      root: tmpDir,
      config,
      previous: baseline.snapshot,
      stableMs: 0,
      nowMs: 1000,
    });

    expect(firstCycle.events).toHaveLength(1);
    expect(firstCycle.deferredCount).toBe(2);
    expect(firstCycle.pending.size).toBe(2);
    expect(firstCycle.warnings.some((warning) => warning.includes("deferred 2"))).toBe(true);

    const secondCycle = await detectWorkspaceChanges({
      root: tmpDir,
      config,
      previous: firstCycle.snapshot,
      pending: firstCycle.pending,
      stableMs: 0,
      nowMs: 2000,
    });

    expect(secondCycle.events).toHaveLength(1);
    expect(secondCycle.deferredCount).toBe(1);
    expect(secondCycle.pending.size).toBe(1);
  });

  it("coalesces repeated pending writes to the final stable state", async () => {
    const filePath = path.join(tmpDir, "coalesce.txt");
    const baseline = await scanWorkspaceForWatch({ root: tmpDir, config: DEFAULT_CONFIG });

    await fs.writeFile(filePath, "first\n", "utf-8");
    const pending = await detectWorkspaceChanges({
      root: tmpDir,
      config: DEFAULT_CONFIG,
      previous: baseline.snapshot,
      nowMs: 1000,
    });

    await fs.writeFile(filePath, "final\n", "utf-8");
    const changedPending = await detectWorkspaceChanges({
      root: tmpDir,
      config: DEFAULT_CONFIG,
      previous: baseline.snapshot,
      pending: pending.pending,
      nowMs: 1200,
    });
    const stable = await detectWorkspaceChanges({
      root: tmpDir,
      config: DEFAULT_CONFIG,
      previous: baseline.snapshot,
      pending: changedPending.pending,
      nowMs: 2500,
    });

    expect(stable.events).toHaveLength(1);
    const events = await queryEvents(tmpDir, { path: "coalesce.txt" });
    expect(stable.snapshot.get("coalesce.txt")?.hash).toBe(events[0]?.afterHash);
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

  it("suppresses watcher duplicate events caused by legacy safeWrite", async () => {
    const baseline = await scanWorkspaceForWatch({ root: tmpDir, config: DEFAULT_CONFIG });

    await safeWrite({
      root: tmpDir,
      path: "legacy-write.txt",
      content: "from safe write\n",
      config: DEFAULT_CONFIG,
    });

    const watched = await detectWorkspaceChanges({
      root: tmpDir,
      config: DEFAULT_CONFIG,
      previous: baseline.snapshot,
      stableMs: 0,
    });
    const events = await queryEvents(tmpDir, {});

    expect(watched.events).toHaveLength(0);
    expect(events).toHaveLength(1);
    expect(events[0]!.tool).toBe("safe_write");
  });

  it("suppresses watcher duplicate events caused by legacy safePatch", async () => {
    await fs.writeFile(path.join(tmpDir, "legacy-patch.txt"), "hello world\n", "utf-8");
    const baseline = await scanWorkspaceForWatch({ root: tmpDir, config: DEFAULT_CONFIG });

    await safePatch({
      root: tmpDir,
      path: "legacy-patch.txt",
      search: "world",
      replace: "SafeFS",
      config: DEFAULT_CONFIG,
    });

    const watched = await detectWorkspaceChanges({
      root: tmpDir,
      config: DEFAULT_CONFIG,
      previous: baseline.snapshot,
      stableMs: 0,
    });
    const events = await queryEvents(tmpDir, {});

    expect(watched.events).toHaveLength(0);
    expect(events).toHaveLength(1);
    expect(events[0]!.tool).toBe("safe_patch");
  });

  it("suppresses watcher duplicate events caused by legacy safeDelete", async () => {
    await fs.writeFile(path.join(tmpDir, "legacy-delete.txt"), "delete me\n", "utf-8");
    const baseline = await scanWorkspaceForWatch({ root: tmpDir, config: DEFAULT_CONFIG });

    await safeDelete({
      root: tmpDir,
      path: "legacy-delete.txt",
      config: DEFAULT_CONFIG,
    });

    const watched = await detectWorkspaceChanges({
      root: tmpDir,
      config: DEFAULT_CONFIG,
      previous: baseline.snapshot,
      stableMs: 0,
    });
    const events = await queryEvents(tmpDir, {});

    expect(watched.events).toHaveLength(0);
    expect(events).toHaveLength(1);
    expect(events[0]!.tool).toBe("safe_delete");
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
  it("skips temp and atomic-save files", async () => {
    await fs.writeFile(path.join(tmpDir, "index.ts.tmp"), "temp", "utf-8");
    await fs.writeFile(path.join(tmpDir, ".DS_Store"), "meta", "utf-8");

    const baseline = await scanWorkspaceForWatch({ root: tmpDir, config: DEFAULT_CONFIG });

    expect(baseline.snapshot.has("index.ts.tmp")).toBe(false);
    expect(baseline.snapshot.has(".DS_Store")).toBe(false);
    expect(baseline.skippedDetails.map((item) => item.reason)).toContain("excluded");
  });

  it("defers deletes briefly to detect same-hash moves across cycles", async () => {
    const config = {
      ...DEFAULT_CONFIG,
      watch: { ...DEFAULT_CONFIG.watch, moveDetectionWindowMs: 5000 },
    };
    const oldPath = path.join(tmpDir, "old-cycle.txt");
    const newPath = path.join(tmpDir, "new-cycle.txt");
    await fs.writeFile(oldPath, "same across cycles\n", "utf-8");
    const baseline = await scanWorkspaceForWatch({ root: tmpDir, config });

    await fs.unlink(oldPath);
    const deletedPending = await detectWorkspaceChanges({
      root: tmpDir,
      config,
      previous: baseline.snapshot,
      stableMs: 0,
      nowMs: 1000,
    });
    expect(deletedPending.events).toHaveLength(0);
    expect(deletedPending.pending.has("old-cycle.txt")).toBe(true);

    await fs.writeFile(newPath, "same across cycles\n", "utf-8");
    const moved = await detectWorkspaceChanges({
      root: tmpDir,
      config,
      previous: deletedPending.snapshot,
      pending: deletedPending.pending,
      stableMs: 0,
      nowMs: 2000,
    });

    expect(moved.events).toHaveLength(1);
    expect(moved.events[0]!.operation).toBe("move");
  });

  it("records deferred deletes after the move detection window expires", async () => {
    const config = {
      ...DEFAULT_CONFIG,
      watch: { ...DEFAULT_CONFIG.watch, moveDetectionWindowMs: 5000 },
    };
    const filePath = path.join(tmpDir, "expired-delete.txt");
    await fs.writeFile(filePath, "gone\n", "utf-8");
    const baseline = await scanWorkspaceForWatch({ root: tmpDir, config });

    await fs.unlink(filePath);
    const pendingDelete = await detectWorkspaceChanges({
      root: tmpDir,
      config,
      previous: baseline.snapshot,
      stableMs: 0,
      nowMs: 1000,
    });
    const expired = await detectWorkspaceChanges({
      root: tmpDir,
      config,
      previous: pendingDelete.snapshot,
      pending: pendingDelete.pending,
      stableMs: 0,
      nowMs: 7000,
    });

    expect(expired.events).toHaveLength(1);
    expect(expired.events[0]!.operation).toBe("delete");
  });

  it("skips symlinks by default", async () => {
    if (process.platform === "win32") return;
    await fs.writeFile(path.join(tmpDir, "target.txt"), "target\n", "utf-8");
    await fs.symlink(path.join(tmpDir, "target.txt"), path.join(tmpDir, "link.txt"));

    const baseline = await scanWorkspaceForWatch({ root: tmpDir, config: DEFAULT_CONFIG });

    expect(baseline.snapshot.has("link.txt")).toBe(false);
    expect(baseline.skippedDetails).toContainEqual({ path: "link.txt", reason: "symlink" });
  });

  it("skips case-colliding paths on case-insensitive filesystems", async () => {
    if (process.platform === "win32") return;
    await fs.mkdir(path.join(tmpDir, ".safefs", "watch"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, ".safefs", "watch", "fs-capabilities.json"),
      JSON.stringify({ caseSensitive: false, checkedAt: new Date().toISOString() }),
      "utf-8"
    );
    await fs.writeFile(path.join(tmpDir, "Readme.md"), "one", "utf-8");
    await fs.writeFile(path.join(tmpDir, "README.md"), "two", "utf-8");
    const entries = await fs.readdir(tmpDir);
    if (!entries.includes("Readme.md") || !entries.includes("README.md")) return;

    const baseline = await scanWorkspaceForWatch({ root: tmpDir, config: DEFAULT_CONFIG });

    expect(baseline.snapshot.has("Readme.md")).toBe(false);
    expect(baseline.snapshot.has("README.md")).toBe(false);
    expect(baseline.skippedDetails.map((item) => item.reason)).toContain("case-collision");
  });

  it("guard runs Windows .cmd shims", async () => {
    if (process.platform !== "win32") return;
    const shimPath = path.join(tmpDir, "agent.cmd");
    await fs.writeFile(
      shimPath,
      "@echo off\r\necho changed> cmd-shim.txt\r\nexit /b 0\r\n",
      "utf-8"
    );

    const exitCode = await runGuard(tmpDir, [shimPath]);

    expect(exitCode).toBe(0);
    await expect(fs.readFile(path.join(tmpDir, "cmd-shim.txt"), "utf-8")).resolves.toContain("changed");
  });

  it("blocks symlink targets outside the workspace even when following is enabled", async () => {
    if (process.platform === "win32") return;
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "safefs-outside-"));
    try {
      const outsideFile = path.join(outsideDir, "outside.txt");
      await fs.writeFile(outsideFile, "outside\n", "utf-8");
      await fs.symlink(outsideFile, path.join(tmpDir, "outside-link.txt"));
      const config = {
        ...DEFAULT_CONFIG,
        workspace: { ...DEFAULT_CONFIG.workspace, followSymlinks: true },
      };

      const baseline = await scanWorkspaceForWatch({ root: tmpDir, config });

      expect(baseline.snapshot.has("outside-link.txt")).toBe(false);
      expect(baseline.skippedDetails).toContainEqual({
        path: "outside-link.txt",
        reason: "path_outside_root",
      });
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });
});
