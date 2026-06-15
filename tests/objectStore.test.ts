import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { saveObject, loadObject, hasObject, getObjectPath } from "../src/core/objectStore.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "safefs-test-"));
  await fs.mkdir(path.join(tmpDir, ".safefs", "objects"), { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("objectStore", () => {
  it("same content saved twice creates one object", async () => {
    const content = "hello world";
    const hash1 = await saveObject(tmpDir, content);
    const hash2 = await saveObject(tmpDir, content);

    expect(hash1).toBe(hash2);

    const prefix = hash1.slice(0, 2);
    const objectsDir = path.join(tmpDir, ".safefs", "objects", prefix);
    const files = await fs.readdir(objectsDir);
    expect(files.length).toBe(1);
  });

  it("different content creates different objects", async () => {
    const hash1 = await saveObject(tmpDir, "content A");
    const hash2 = await saveObject(tmpDir, "content B");

    expect(hash1).not.toBe(hash2);
  });

  it("saved object can be loaded", async () => {
    const content = "test content for loading";
    const hash = await saveObject(tmpDir, content);
    const loaded = await loadObject(tmpDir, hash);

    expect(loaded.toString("utf-8")).toBe(content);
  });

  it("missing object throws friendly error", async () => {
    await expect(loadObject(tmpDir, "0".repeat(64))).rejects.toThrow(
      "Object not found"
    );
  });

  it("object path uses first two hash chars", async () => {
    const content = "path check";
    const hash = await saveObject(tmpDir, content);
    const objPath = getObjectPath(tmpDir, hash);

    const prefix = hash.slice(0, 2);
    expect(objPath).toContain(path.join(".safefs", "objects", prefix, hash));
  });

  it("hasObject returns true for existing objects", async () => {
    const hash = await saveObject(tmpDir, "exists");
    expect(await hasObject(tmpDir, hash)).toBe(true);
  });

  it("hasObject returns false for missing objects", async () => {
    expect(await hasObject(tmpDir, "1".repeat(64))).toBe(false);
  });

  it("preserves exact bytes including binary", async () => {
    const buffer = Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x0a, 0x0d]);
    const hash = await saveObject(tmpDir, buffer);
    const loaded = await loadObject(tmpDir, hash);

    expect(Buffer.compare(loaded, buffer)).toBe(0);
  });
});
