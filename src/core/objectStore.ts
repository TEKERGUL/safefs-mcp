import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gzip, gunzip } from "node:zlib";
import { sha256Buffer } from "./hash.js";
import { SafeFSError } from "../types/index.js";
import type { StorageStats } from "../types/index.js";
import { atomicWriteFile } from "./workspace.js";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const COMPRESSED_OBJECT_MAGIC = Buffer.from("SAFEFS_OBJECT_GZIP_V1\n", "utf-8");

function assertValidHash(hash: string): void {
  const HEX_RE = /^[0-9a-f]{64}$/;
  if (!HEX_RE.test(hash)) {
    throw new SafeFSError("INVALID_HASH", `Invalid object hash format: ${hash}`);
  }
}

function getObjectFilePath(root: string, hash: string): string {
  const prefix = hash.slice(0, 2);
  return path.join(root, ".safefs", "objects", prefix, hash);
}

export async function saveObject(
  root: string,
  content: Buffer | string,
  options: { compression?: boolean } = {}
): Promise<string> {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const hash = sha256Buffer(buffer);
  assertValidHash(hash);

  const objPath = getObjectFilePath(root, hash);

  try {
    const existing = await fs.readFile(objPath);
    const decoded = await decodeObjectFile(existing);
    if (sha256Buffer(decoded) === hash && decoded.equals(buffer)) {
      return hash;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }

  const stored = options.compression ? await encodeCompressedObject(buffer) : buffer;
  await atomicWriteFile(objPath, stored, { mode: 0o600, verify: true });

  const written = await fs.readFile(objPath);
  const decoded = await decodeObjectFile(written);
  if (sha256Buffer(decoded) !== hash || !decoded.equals(buffer)) {
    throw new SafeFSError("OBJECT_WRITE_VERIFY_FAILED", `Object verification failed: ${hash}`);
  }

  return hash;
}

export async function loadObject(root: string, hash: string): Promise<Buffer> {
  assertValidHash(hash);
  const objPath = getObjectFilePath(root, hash);

  try {
    return await decodeObjectFile(await fs.readFile(objPath));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new SafeFSError(
        "OBJECT_NOT_FOUND",
        `Object not found: ${hash}`
      );
    }
    throw err;
  }
}

async function encodeCompressedObject(buffer: Buffer): Promise<Buffer> {
  const compressed = await gzipAsync(buffer);
  return Buffer.concat([COMPRESSED_OBJECT_MAGIC, compressed]);
}

async function decodeObjectFile(buffer: Buffer): Promise<Buffer> {
  if (!buffer.subarray(0, COMPRESSED_OBJECT_MAGIC.length).equals(COMPRESSED_OBJECT_MAGIC)) {
    return buffer;
  }

  try {
    return await gunzipAsync(buffer.subarray(COMPRESSED_OBJECT_MAGIC.length));
  } catch (err) {
    throw new SafeFSError(
      "OBJECT_DECOMPRESS_FAILED",
      `Failed to decompress SafeFS object: ${err instanceof Error ? err.message : "unknown error"}`
    );
  }
}

export async function hasObject(root: string, hash: string): Promise<boolean> {
  assertValidHash(hash);
  const objPath = getObjectFilePath(root, hash);
  try {
    await fs.access(objPath);
    return true;
  } catch {
    return false;
  }
}

export function getObjectPath(root: string, hash: string): string {
  return getObjectFilePath(root, hash);
}

export async function getStorageStats(root: string): Promise<StorageStats> {
  const objectsDir = path.join(root, ".safefs", "objects");

  let objectCount = 0;
  let totalSize = 0;

  try {
    const prefixes = await fs.readdir(objectsDir);
    for (const prefix of prefixes) {
      const prefixDir = path.join(objectsDir, prefix);
      const stat = await fs.stat(prefixDir);
      if (!stat.isDirectory()) continue;

      const files = await fs.readdir(prefixDir);
      for (const file of files) {
        const filePath = path.join(prefixDir, file);
        const fileStat = await fs.stat(filePath);
        if (fileStat.isFile()) {
          objectCount++;
          totalSize += fileStat.size;
        }
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }

  return {
    objectCount,
    totalObjectSizeBytes: totalSize,
    approximateSize: formatBytes(totalSize),
  };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const k = 1024;
  let i = Math.floor(Math.log(bytes) / Math.log(k));
  if (i >= units.length) i = units.length - 1;
  const val = bytes / k ** i;
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
