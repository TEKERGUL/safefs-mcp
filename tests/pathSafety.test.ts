import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { resolveSafePath } from "../src/core/pathSafety.js";
import { DEFAULT_CONFIG } from "../src/config/defaultConfig.js";
import type { SafeFSConfig } from "../src/types/index.js";

let tmpDir: string;
let config: SafeFSConfig;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "safefs-path-"));
  config = { ...DEFAULT_CONFIG };
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("pathSafety", () => {
  it("path traversal blocked", async () => {
    await expect(
      resolveSafePath({
        root: tmpDir,
        requestedPath: "../../../etc/passwd",
        config,
      })
    ).rejects.toThrow("outside workspace root");
  });

  it("absolute outside path blocked", async () => {
    await expect(
      resolveSafePath({
        root: tmpDir,
        requestedPath: "/etc/passwd",
        config,
      })
    ).rejects.toThrow("outside workspace root");
  });

  it("null byte blocked", async () => {
    await expect(
      resolveSafePath({
        root: tmpDir,
        requestedPath: "file\0.txt",
        config,
      })
    ).rejects.toThrow("null bytes");
  });

  it(".safefs access blocked", async () => {
    await expect(
      resolveSafePath({
        root: tmpDir,
        requestedPath: ".safefs/timeline/events.jsonl",
        config,
      })
    ).rejects.toThrow(".safefs/ internals");
  });

  it(".safefs root path blocked", async () => {
    await expect(
      resolveSafePath({
        root: tmpDir,
        requestedPath: ".safefs",
        config,
      })
    ).rejects.toThrow(".safefs/ internals");
  });

  it(".git/config blocked", async () => {
    await expect(
      resolveSafePath({
        root: tmpDir,
        requestedPath: ".git/config",
        config,
      })
    ).rejects.toThrow("protected");
  });

  it(".env blocked", async () => {
    await expect(
      resolveSafePath({
        root: tmpDir,
        requestedPath: ".env",
        config,
      })
    ).rejects.toThrow("protected");
  });

  it(".env.local blocked", async () => {
    await expect(
      resolveSafePath({
        root: tmpDir,
        requestedPath: ".env.local",
        config,
      })
    ).rejects.toThrow("protected");
  });

  it("nested protected file blocked (secrets/api.key)", async () => {
    await expect(
      resolveSafePath({
        root: tmpDir,
        requestedPath: "secrets/api.key",
        config,
      })
    ).rejects.toThrow("protected");
  });

  it("node_modules blocked", async () => {
    await expect(
      resolveSafePath({
        root: tmpDir,
        requestedPath: "node_modules/pkg/index.js",
        config,
      })
    ).rejects.toThrow("protected");
  });

  it("mandatory protected patterns cannot be disabled by config", async () => {
    const permissiveConfig: SafeFSConfig = {
      ...config,
      protected: [],
    };

    await expect(
      resolveSafePath({
        root: tmpDir,
        requestedPath: ".git/config",
        config: permissiveConfig,
      })
    ).rejects.toThrow("protected");

    await expect(
      resolveSafePath({
        root: tmpDir,
        requestedPath: ".env",
        config: permissiveConfig,
      })
    ).rejects.toThrow("protected");

    await expect(
      resolveSafePath({
        root: tmpDir,
        requestedPath: "nested/secrets/api.key",
        config: permissiveConfig,
      })
    ).rejects.toThrow("protected");
  });

  it("normal allowed file passes", async () => {
    const result = await resolveSafePath({
      root: tmpDir,
      requestedPath: "src/app.ts",
      config,
    });
    expect(result.relativePath).toBe("src/app.ts");
    expect(result.absolutePath).toBe(path.resolve(tmpDir, "src/app.ts"));
  });

  it("allowSafefsInternal permits .safefs access", async () => {
    const result = await resolveSafePath({
      root: tmpDir,
      requestedPath: ".safefs/timeline/events.jsonl",
      allowSafefsInternal: true,
      config,
    });
    expect(result.relativePath).toBe(".safefs/timeline/events.jsonl");
  });

  it("symlink escape blocked", async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "safefs-outside-"));
    const outsideFile = path.join(outsideDir, "secret.txt");
    await fs.writeFile(outsideFile, "secret data");

    const linkPath = path.join(tmpDir, "escape-link");
    try {
      await fs.symlink(outsideFile, linkPath);
    } catch {
      // skip on systems that don't support symlinks
      await fs.rm(outsideDir, { recursive: true, force: true });
      return;
    }

    await expect(
      resolveSafePath({
        root: tmpDir,
        requestedPath: "escape-link",
        config,
      })
    ).rejects.toThrow("outside workspace root");

    await fs.rm(outsideDir, { recursive: true, force: true });
  });
});
