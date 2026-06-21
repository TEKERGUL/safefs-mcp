import fs from "node:fs/promises";
import path from "node:path";
import { recordExternalChange, snapshotFileForExternalTracking } from "./externalChangeRecorder.js";
import { resolveSafePath } from "./pathSafety.js";
import type { ExternalChangeResult, FileSnapshot } from "./externalChangeRecorder.js";
import type { SafeFSConfig } from "../types/index.js";
import { SafeFSError } from "../types/index.js";

export type WatchSnapshot = Map<string, FileSnapshot>;

export interface WatchScanResult {
  snapshot: WatchSnapshot;
  skipped: string[];
}

export interface WatchCycleResult extends WatchScanResult {
  events: ExternalChangeResult[];
}

export async function scanWorkspaceForWatch(options: {
  root: string;
  config: SafeFSConfig;
  previous?: WatchSnapshot;
}): Promise<WatchScanResult> {
  const root = path.resolve(options.root);
  const snapshot: WatchSnapshot = new Map();
  const skipped: string[] = [];

  await scanDirectory({
    root,
    directory: root,
    config: options.config,
    previous: options.previous,
    snapshot,
    skipped,
  });

  return { snapshot, skipped };
}

export async function detectWorkspaceChanges(options: {
  root: string;
  config: SafeFSConfig;
  previous: WatchSnapshot;
  tool?: string;
  sessionId?: string;
}): Promise<WatchCycleResult> {
  const scan = await scanWorkspaceForWatch({
    root: options.root,
    config: options.config,
    previous: options.previous,
  });
  const paths = new Set([...options.previous.keys(), ...scan.snapshot.keys()]);
  const events: ExternalChangeResult[] = [];

  for (const filePath of [...paths].sort()) {
    const before = options.previous.get(filePath) ?? null;
    const after = scan.snapshot.get(filePath) ?? null;
    const result = await recordExternalChange({
      root: options.root,
      path: filePath,
      before,
      after,
      tool: options.tool ?? "safefs_watch",
      reason: "Detected by SafeFS workspace watcher",
      sessionId: options.sessionId,
      config: options.config,
    });

    if (result.recorded) {
      events.push(result);
    }
  }

  return {
    snapshot: scan.snapshot,
    skipped: scan.skipped,
    events,
  };
}

async function scanDirectory(options: {
  root: string;
  directory: string;
  config: SafeFSConfig;
  previous?: WatchSnapshot;
  snapshot: WatchSnapshot;
  skipped: string[];
}): Promise<void> {
  const entries = await fs.readdir(options.directory, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(options.directory, entry.name);
    const relativePath = toPosixRelative(options.root, absolutePath);
    if (!relativePath) continue;

    if (entry.isDirectory()) {
      if (await shouldSkipPath(options.root, relativePath, options.config)) {
        continue;
      }
      await scanDirectory({
        ...options,
        directory: absolutePath,
      });
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const previous = options.previous?.get(relativePath);
    try {
      const stat = await fs.stat(absolutePath);
      if (
        previous &&
        previous.size === stat.size &&
        previous.mtimeMs === stat.mtimeMs
      ) {
        options.snapshot.set(relativePath, previous);
        continue;
      }

      const fileSnapshot = await snapshotFileForExternalTracking({
        root: options.root,
        path: relativePath,
        config: options.config,
      });

      if (fileSnapshot) {
        options.snapshot.set(relativePath, fileSnapshot);
      }
    } catch (err) {
      if (isSkippableSafeFSError(err)) {
        options.skipped.push(relativePath);
        continue;
      }
      throw err;
    }
  }
}

async function shouldSkipPath(
  root: string,
  relativePath: string,
  config: SafeFSConfig
): Promise<boolean> {
  try {
    await resolveSafePath({
      root,
      requestedPath: relativePath,
      config,
    });
    return false;
  } catch (err) {
    if (isSkippableSafeFSError(err)) return true;
    throw err;
  }
}

function isSkippableSafeFSError(err: unknown): boolean {
  return (
    err instanceof SafeFSError &&
    (err.code === "PROTECTED_PATH" ||
      err.code === "SAFEFS_INTERNAL_ACCESS" ||
      err.code === "FILE_TOO_LARGE")
  );
}

function toPosixRelative(root: string, absolutePath: string): string {
  const relative = path.relative(root, absolutePath);
  return relative.split(path.sep).join("/");
}
