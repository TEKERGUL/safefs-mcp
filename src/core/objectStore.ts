import fs from "node:fs/promises";
import path from "node:path";
import { sha256Buffer } from "./hash.js";
import { SafeFSError } from "../types/index.js";
import type { StorageStats } from "../types/index.js";
import { atomicWriteFile } from "./workspace.js";

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
  content: Buffer | string
): Promise<string> {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const hash = sha256Buffer(buffer);
  assertValidHash(hash);

  const objPath = getObjectFilePath(root, hash);

  try {
    const existing = await fs.readFile(objPath);
    if (sha256Buffer(existing) === hash && existing.equals(buffer)) {
      return hash;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }

  await atomicWriteFile(objPath, buffer, { mode: 0o600, verify: true });

  const written = await fs.readFile(objPath);
  if (sha256Buffer(written) !== hash || !written.equals(buffer)) {
    throw new SafeFSError("OBJECT_WRITE_VERIFY_FAILED", `Object verification failed: ${hash}`);
  }

  return hash;
}

export async function loadObject(root: string, hash: string): Promise<Buffer> {
  assertValidHash(hash);
  const objPath = getObjectFilePath(root, hash);

  try {
    return await fs.readFile(objPath);
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
  const val = bytes / Math.pow(k, i);
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
