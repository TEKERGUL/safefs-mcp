import fs from "node:fs/promises";
import { createReadStream, type Stats } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { TimelineEvent, TimelineFilter } from "../types/index.js";
import { timelineMutex } from "./mutex.js";

const TIMELINE_DIR = ".safefs/timeline";
const TIMELINE_FILE = "events.jsonl";

function getTimelinePath(root: string): string {
  return path.join(root, TIMELINE_DIR, TIMELINE_FILE);
}

export function generateEventId(): string {
  return `evt_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export async function appendEvent(
  root: string,
  event: TimelineEvent
): Promise<void> {
  const filePath = getTimelinePath(root);
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  const line = JSON.stringify(event) + "\n";
  const release = await timelineMutex.acquire();
  try {
    await fs.appendFile(filePath, line, "utf-8");
  } finally {
    release();
  }
}

export async function queryEvents(
  root: string,
  filter: TimelineFilter
): Promise<TimelineEvent[]> {
  const rawEvents = await readTimelineEvents(root);
  const latestEvents = coalesceLatestEvents(rawEvents);
  const results: TimelineEvent[] = [];

  for (const event of latestEvents) {
    if (!matchesFilter(event, filter)) continue;

    results.push(event);

    if (filter.limit && results.length >= filter.limit) {
      break;
    }
  }

  return results;
}

export async function queryRawEvents(root: string): Promise<TimelineEvent[]> {
  return readTimelineEvents(root);
}

function coalesceLatestEvents(events: TimelineEvent[]): TimelineEvent[] {
  const latestById = new Map<string, TimelineEvent>();

  for (const event of events) {
    latestById.set(event.eventId, event);
  }

  return [...latestById.values()];
}

async function readTimelineEvents(root: string): Promise<TimelineEvent[]> {
  const filePath = getTimelinePath(root);

  try {
    await fs.access(filePath);
  } catch {
    return [];
  }

  const results: TimelineEvent[] = [];
  const stream = createReadStream(filePath, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let event: TimelineEvent;
    try {
      event = JSON.parse(trimmed) as TimelineEvent;
    } catch (err) {
      console.warn(`[SafeFS] Warning: Skipping corrupted timeline event line: ${(err as Error).message}`);
      continue;
    }

    results.push(event);
  }

  return results;
}

function matchesFilter(event: TimelineEvent, filter: TimelineFilter): boolean {
  if (filter.since) {
    const eventTime = new Date(event.timestamp);
    if (eventTime < filter.since) return false;
  }

  if (filter.until) {
    const eventTime = new Date(event.timestamp);
    if (eventTime > filter.until) return false;
  }

  if (filter.path) {
    if (event.path !== filter.path) return false;
  }

  if (filter.sessionId) {
    if (event.sessionId !== filter.sessionId) return false;
  }

  if (filter.operation) {
    if (event.operation !== filter.operation) return false;
  }

  return true;
}

export async function queryRecentEvents(
  root: string,
  filter: { since: Date; path?: string }
): Promise<TimelineEvent[]> {
  const filePath = getTimelinePath(root);
  const CHUNK_SIZE = 64 * 1024;

  let stat: Stats;
  try {
    stat = await fs.stat(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  if (stat.size === 0) return [];

  const fileHandle = await fs.open(filePath, "r");
  try {
    const results: TimelineEvent[] = [];
    let position = stat.size;
    let carry = "";
    let reachedCutoff = false;

    while (position > 0 && !reachedCutoff) {
      const readSize = Math.min(CHUNK_SIZE, position);
      position -= readSize;

      const buf = Buffer.alloc(readSize);
      await fileHandle.read(buf, 0, readSize, position);

      const text = buf.toString("utf-8") + carry;
      const lines = text.split("\n");
      carry = position > 0 ? lines.shift() ?? "" : "";

      for (let index = lines.length - 1; index >= 0; index--) {
        const trimmed = lines[index]!.trim();
        if (!trimmed) continue;

        try {
          const event = JSON.parse(trimmed) as TimelineEvent;
          if (new Date(event.timestamp) < filter.since) {
            reachedCutoff = true;
            break;
          }
          if (filter.path && event.path !== filter.path) continue;
          results.push(event);
        } catch {
          continue;
        }
      }
    }

    return results.reverse();
  } finally {
    await fileHandle.close();
  }
}

export async function getTimelineBounds(
  root: string
): Promise<{ oldest?: string; newest?: string }> {
  const filePath = getTimelinePath(root);

  let stat: Stats;
  try {
    stat = await fs.stat(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }

  if (stat.size === 0) return {};

  const fileHandle = await fs.open(filePath, "r");
  try {
    const HEAD_SIZE = 4096;
    const headBuf = Buffer.alloc(Math.min(HEAD_SIZE, stat.size));
    await fileHandle.read(headBuf, 0, headBuf.length, 0);
    const firstLine = headBuf.toString("utf-8").split("\n")[0]?.trim();

    const TAIL_SIZE = 4096;
    const tailStart = Math.max(0, stat.size - TAIL_SIZE);
    const tailBuf = Buffer.alloc(Math.min(TAIL_SIZE, stat.size));
    await fileHandle.read(tailBuf, 0, tailBuf.length, tailStart);
    const tailLines = tailBuf.toString("utf-8").split("\n").filter((l) => l.trim());
    const lastLine = tailLines[tailLines.length - 1]?.trim();

    let oldest: string | undefined;
    let newest: string | undefined;

    if (firstLine) {
      try {
        oldest = (JSON.parse(firstLine) as TimelineEvent).timestamp;
      } catch { /* corrupted first line */ }
    }
    if (lastLine) {
      try {
        newest = (JSON.parse(lastLine) as TimelineEvent).timestamp;
      } catch { /* corrupted last line */ }
    }

    return { oldest, newest };
  } finally {
    await fileHandle.close();
  }
}

export async function getEventCount(root: string): Promise<number> {
  const filePath = getTimelinePath(root);

  try {
    await fs.access(filePath);
  } catch {
    return 0;
  }

  let count = 0;
  const stream = createReadStream(filePath, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (line.trim()) count++;
  }

  return count;
}
