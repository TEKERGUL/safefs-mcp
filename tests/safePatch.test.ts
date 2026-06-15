import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { safePatch } from "../src/tools/safePatch.js";
import { queryEvents } from "../src/core/timeline.js";
import { loadObject } from "../src/core/objectStore.js";
import { DEFAULT_CONFIG } from "../src/config/defaultConfig.js";
import type { SafeFSConfig } from "../src/types/index.js";

let tmpDir: string;
let config: SafeFSConfig;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "safefs-patch-"));
  await fs.mkdir(path.join(tmpDir, ".safefs", "timeline"), { recursive: true });
  await fs.mkdir(path.join(tmpDir, ".safefs", "objects"), { recursive: true });
  config = { ...DEFAULT_CONFIG };
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("safePatch", () => {
  it("patch applies replacement", async () => {
    await fs.writeFile(path.join(tmpDir, "app.ts"), "const x = 1;\nconst y = 2;\n");

    const result = await safePatch({
      root: tmpDir,
      path: "app.ts",
      search: "const x = 1;",
      replace: "const x = 42;",
      config,
    });

    expect(result.success).toBe(true);
    expect(result.operation).toBe("patch");

    const content = await fs.readFile(path.join(tmpDir, "app.ts"), "utf-8");
    expect(content).toBe("const x = 42;\nconst y = 2;\n");
  });

  it("missing search returns error", async () => {
    await fs.writeFile(path.join(tmpDir, "app.ts"), "hello world");

    await expect(
      safePatch({
        root: tmpDir,
        path: "app.ts",
        search: "not found text",
        replace: "replacement",
        config,
      })
    ).rejects.toThrow("not found");
  });

  it("ambiguous search without replaceAll returns error", async () => {
    await fs.writeFile(path.join(tmpDir, "app.ts"), "foo bar foo baz foo");

    await expect(
      safePatch({
        root: tmpDir,
        path: "app.ts",
        search: "foo",
        replace: "qux",
        config,
      })
    ).rejects.toThrow("multiple locations");
  });

  it("replaceAll applies to all occurrences", async () => {
    await fs.writeFile(path.join(tmpDir, "app.ts"), "foo bar foo baz foo");

    const result = await safePatch({
      root: tmpDir,
      path: "app.ts",
      search: "foo",
      replace: "qux",
      replaceAll: true,
      config,
    });

    expect(result.success).toBe(true);
    const content = await fs.readFile(path.join(tmpDir, "app.ts"), "utf-8");
    expect(content).toBe("qux bar qux baz qux");
  });

  it("patch stores beforeObject", async () => {
    const original = "line 1\nline 2\nline 3\n";
    await fs.writeFile(path.join(tmpDir, "file.txt"), original);

    await safePatch({
      root: tmpDir,
      path: "file.txt",
      search: "line 2",
      replace: "line two",
      config,
    });

    const events = await queryEvents(tmpDir, {});
    const event = events[0]!;
    expect(event.beforeObject).toBeTruthy();

    const restored = await loadObject(tmpDir, event.beforeObject!);
    expect(restored.toString("utf-8")).toBe(original);
  });

  it("patch stores patch metadata", async () => {
    await fs.writeFile(path.join(tmpDir, "meta.ts"), "a\nb\nc\nd\ne\n");

    await safePatch({
      root: tmpDir,
      path: "meta.ts",
      search: "c",
      replace: "C",
      config,
    });

    const events = await queryEvents(tmpDir, {});
    const event = events[0]!;
    expect(event.patch).toBeDefined();
    expect(event.patch!.search).toBe("c");
    expect(event.patch!.replace).toBe("C");
    expect(event.patch!.beforeBlockObject).toBeTruthy();
    expect(event.patch!.afterBlockObject).toBeTruthy();
  });

  it("timeline event includes lineStart and lineEnd", async () => {
    await fs.writeFile(path.join(tmpDir, "lines.ts"), "a\nb\nc\nd\ne\n");

    await safePatch({
      root: tmpDir,
      path: "lines.ts",
      search: "c",
      replace: "C",
      config,
    });

    const events = await queryEvents(tmpDir, {});
    const event = events[0]!;
    expect(event.patch!.lineStart).toBe(3);
    expect(event.patch!.lineEnd).toBe(3);
  });

  it("file not found returns error", async () => {
    await expect(
      safePatch({
        root: tmpDir,
        path: "nonexistent.ts",
        search: "x",
        replace: "y",
        config,
      })
    ).rejects.toThrow("not found");
  });
});
