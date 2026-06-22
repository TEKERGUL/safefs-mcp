import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import { timelineMutex } from "./mutex.js";
import { atomicWriteFile } from "./workspace.js";
import type { TimelineEvent } from "../types/index.js";

const TIMELINE_DIR = ".safefs/timeline";
const TIMELINE_FILE = "events.jsonl";

function getTimelinePath(root: string): string {
  return path.join(root, TIMELINE_DIR, TIMELINE_FILE);
}

export interface PruneResult {
  pruned: number;
  retained: number;
  dryRun: boolean;
}

export async function pruneTimeline(
  root: string,
  options: { retentionDays: number; dryRun?: boolean }
): Promise<PruneResult> {
  const filePath = getTimelinePath(root);
  const cutoff = new Date(Date.now() - options.retentionDays * 86_400_000);
  const dryRun = options.dryRun ?? false;

  try {
    await fs.access(filePath);
  } catch {
    return { pruned: 0, retained: 0, dryRun };
  }

  const release = await timelineMutex.acquire();
  try {
    const retained: string[] = [];
    let pruned = 0;

    const stream = createReadStream(filePath, { encoding: "utf-8" });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const event = JSON.parse(trimmed) as TimelineEvent;
        if (new Date(event.timestamp) < cutoff) {
          pruned++;
        } else {
          retained.push(trimmed);
        }
      } catch {
        pruned++;
      }
    }

    if (pruned === 0) {
      return { pruned: 0, retained: retained.length, dryRun };
    }

    const newContent = retained.length > 0
      ? retained.join("\n") + "\n"
      : "";

    if (!dryRun) {
      await atomicWriteFile(filePath, newContent);
    }

    return { pruned, retained: retained.length, dryRun };
  } finally {
    release();
  }
}
