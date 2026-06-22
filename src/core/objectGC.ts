import fs from "node:fs/promises";
import path from "node:path";
import { queryRawEvents } from "./timeline.js";
import { timelineMutex } from "./mutex.js";

export interface GCResult {
  deleted: number;
  freedBytes: number;
  retained: number;
  skippedYoung: number;
  dryRun: boolean;
}

export async function collectGarbage(
  root: string,
  options: { dryRun?: boolean; graceMs?: number } = {}
): Promise<GCResult> {
  const dryRun = options.dryRun ?? false;
  const graceMs = options.graceMs ?? 60_000;
  const now = Date.now();
  const release = await timelineMutex.acquire();
  let referencedHashes: Set<string>;
  try {
    const events = await queryRawEvents(root);
    referencedHashes = new Set<string>();

    for (const event of events) {
      if (event.beforeObject) referencedHashes.add(event.beforeObject);
      if (event.afterObject) referencedHashes.add(event.afterObject);
      if (event.patch?.beforeBlockObject) referencedHashes.add(event.patch.beforeBlockObject);
      if (event.patch?.afterBlockObject) referencedHashes.add(event.patch.afterBlockObject);
    }
  } finally {
    release();
  }

  const objectsDir = path.join(root, ".safefs", "objects");
  let deleted = 0;
  let freedBytes = 0;
  let retained = 0;
  let skippedYoung = 0;

  try {
    const prefixes = await fs.readdir(objectsDir);
    for (const prefix of prefixes) {
      const prefixDir = path.join(objectsDir, prefix);
      const stat = await fs.stat(prefixDir);
      if (!stat.isDirectory()) continue;

      const files = await fs.readdir(prefixDir);
      for (const file of files) {
        const filePath = path.join(prefixDir, file);
        if (referencedHashes.has(file)) {
          retained++;
          continue;
        }

        try {
          const fileStat = await fs.stat(filePath);
          if (fileStat.isFile()) {
            if (graceMs > 0 && now - fileStat.mtimeMs < graceMs) {
              skippedYoung++;
              retained++;
              continue;
            }
            if (!dryRun) {
              await fs.unlink(filePath);
            }
            deleted++;
            freedBytes += fileStat.size;
          }
        } catch {
          // skip files we can't stat/delete
        }
      }

      // remove empty prefix dir
      try {
        const remaining = await fs.readdir(prefixDir);
        if (!dryRun && remaining.length === 0) {
          await fs.rmdir(prefixDir);
        }
      } catch { /* ignore */ }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }

  return { deleted, freedBytes, retained, skippedYoung, dryRun };
}
