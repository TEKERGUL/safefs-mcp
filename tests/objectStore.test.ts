import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { saveObject, loadObject, hasObject, getObjectPath } from "../src/core/objectStore.js";
import { SafeFSError } from "../src/types/index.js";

const COMPRESSED_OBJECT_MAGIC = Buffer.from("SAFEFS_OBJECT_GZIP_V1\n", "utf-8");

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

  it("compressed objects roundtrip exact bytes", async () => {
    const buffer = Buffer.from("repeat me ".repeat(200), "utf-8");
    const hash = await saveObject(tmpDir, buffer, { compression: true });
    const objectPath = getObjectPath(tmpDir, hash);
    const stored = await fs.readFile(objectPath);

    expect(stored.subarray(0, COMPRESSED_OBJECT_MAGIC.length).equals(COMPRESSED_OBJECT_MAGIC)).toBe(true);
    await expect(loadObject(tmpDir, hash)).resolves.toEqual(buffer);
  });

  it("raw pre-existing objects remain readable", async () => {
    const buffer = Buffer.from("plain object", "utf-8");
    const hash = await saveObject(tmpDir, buffer);
    const stored = await fs.readFile(getObjectPath(tmpDir, hash));

    expect(stored.subarray(0, COMPRESSED_OBJECT_MAGIC.length).equals(COMPRESSED_OBJECT_MAGIC)).toBe(false);
    await expect(loadObject(tmpDir, hash)).resolves.toEqual(buffer);
  });

  it("dedupes by original content hash regardless of compression setting", async () => {
    const buffer = Buffer.from("dedupe me ".repeat(50), "utf-8");
    const rawHash = await saveObject(tmpDir, buffer);
    const compressedAttemptHash = await saveObject(tmpDir, buffer, { compression: true });
    const stored = await fs.readFile(getObjectPath(tmpDir, rawHash));

    expect(compressedAttemptHash).toBe(rawHash);
    expect(stored.subarray(0, COMPRESSED_OBJECT_MAGIC.length).equals(COMPRESSED_OBJECT_MAGIC)).toBe(false);
  });

  it("reports corrupt compressed objects with a friendly error code", async () => {
    const hash = await saveObject(tmpDir, "will be corrupted", { compression: true });
    await fs.writeFile(getObjectPath(tmpDir, hash), Buffer.concat([COMPRESSED_OBJECT_MAGIC, Buffer.from("bad gzip")]));

    try {
      await loadObject(tmpDir, hash);
      expect.unreachable("Expected corrupt compressed object to fail");
    } catch (err) {
      expect(err).toBeInstanceOf(SafeFSError);
      expect((err as SafeFSError).code).toBe("OBJECT_DECOMPRESS_FAILED");
    }
  });
});
