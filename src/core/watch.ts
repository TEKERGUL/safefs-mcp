import fs from "node:fs/promises";
import path from "node:path";
import picomatch from "picomatch";
import {
  recordExternalChange,
  recordExternalMove,
  snapshotFileForExternalTracking,
} from "./externalChangeRecorder.js";
import { resolveSafePath } from "./pathSafety.js";
import { loadSuppressionState, isPathSuppressedBy } from "./suppression.js";
import type { ExternalChangeResult, FileSnapshot } from "./externalChangeRecorder.js";
import type { SafeFSConfig } from "../types/index.js";
import { SafeFSError } from "../types/index.js";

export type WatchSnapshot = Map<string, FileSnapshot>;
export type WatchPendingChanges = Map<string, WatchPendingChange>;

export interface WatchPendingChange {
  path: string;
  before: FileSnapshot | null;
  after: FileSnapshot | null;
  firstSeenMs: number;
  signature: string;
}

export interface WatchSkipDetail {
  path: string;
  reason: string;
}

export interface WatchScanResult {
  snapshot: WatchSnapshot;
  skipped: string[];
  skippedDetails: WatchSkipDetail[];
  trackedBytes: number;
}

export interface WatchCycleResult extends WatchScanResult {
  events: ExternalChangeResult[];
  pending: WatchPendingChanges;
}

interface WatchMatchers {
  exclude: Array<(value: string) => boolean>;
}

let cachedMatchers: WatchMatchers | null = null;
let cachedMatcherKey: string | null = null;

async function getOrCreateWatchMatchers(root: string, config: SafeFSConfig): Promise<WatchMatchers> {
  const patterns = [...config.watch.exclude];
  let gitignoreContent = "";
  if (config.watch.respectGitignore) {
    try {
      gitignoreContent = await fs.readFile(path.join(root, ".gitignore"), "utf-8");
    } catch { /* no gitignore */ }
  }

  const key = JSON.stringify(patterns) + "\0" + gitignoreContent;
  if (cachedMatcherKey === key && cachedMatchers) {
    return cachedMatchers;
  }

  const gitPatterns = gitignoreContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("!"));

  const allPatterns = [...patterns, ...gitPatterns];
  cachedMatchers = {
    exclude: allPatterns.flatMap((p) => createMatchersForPattern(p)),
  };
  cachedMatcherKey = key;
  return cachedMatchers;
}

export async function scanWorkspaceForWatch(options: {
  root: string;
  config: SafeFSConfig;
  previous?: WatchSnapshot;
  dryRun?: boolean;
}): Promise<WatchScanResult> {
  const root = path.resolve(options.root);
  const snapshot: WatchSnapshot = new Map();
  const skippedDetails: WatchSkipDetail[] = [];
  const matchers = await getOrCreateWatchMatchers(root, options.config);
  const budget = {
    usedBytes: 0,
    maxBytes: options.config.watch.maxSnapshotBytesMB * 1024 * 1024,
  };

  await scanDirectory({
    root,
    directory: root,
    config: options.config,
    previous: options.previous,
    snapshot,
    skippedDetails,
    matchers,
    budget,
    dryRun: options.dryRun,
  });

  return {
    snapshot,
    skipped: skippedDetails.map((item) => item.path),
    skippedDetails,
    trackedBytes: budget.usedBytes,
  };
}

export async function detectWorkspaceChanges(options: {
  root: string;
  config: SafeFSConfig;
  previous: WatchSnapshot;
  pending?: WatchPendingChanges;
  tool?: string;
  sessionId?: string;
  nowMs?: number;
  stableMs?: number;
}): Promise<WatchCycleResult> {
  const nowMs = options.nowMs ?? Date.now();
  const stableMs = options.stableMs ?? options.config.watch.debounceMs;
  const scan = await scanWorkspaceForWatch({
    root: options.root,
    config: options.config,
    previous: options.previous,
  });
  const paths = new Set([...options.previous.keys(), ...scan.snapshot.keys()]);
  const nextPending: WatchPendingChanges = new Map();
  const stableChanges: WatchPendingChange[] = [];
  const nextSnapshot: WatchSnapshot = new Map(options.previous);
  const suppression = await loadSuppressionState(options.root);

  for (const filePath of [...paths].sort()) {
    const before = options.previous.get(filePath) ?? null;
    const after = scan.snapshot.get(filePath) ?? null;
    if (before?.hash === after?.hash) {
      if (after) nextSnapshot.set(filePath, after);
      continue;
    }

    if (isPathSuppressedBy(suppression, filePath)) {
      applySnapshotChange(nextSnapshot, filePath, after);
      continue;
    }

    const signature = createChangeSignature(before, after);
    const existing = options.pending?.get(filePath);
    const pendingChange: WatchPendingChange =
      existing && existing.signature === signature
        ? existing
        : {
            path: filePath,
            before,
            after,
            firstSeenMs: nowMs,
            signature,
          };

    if (nowMs - pendingChange.firstSeenMs >= stableMs) {
      stableChanges.push(pendingChange);
    } else {
      nextPending.set(filePath, pendingChange);
    }
  }

  const events = await recordStableChanges({
    root: options.root,
    config: options.config,
    stableChanges,
    nextSnapshot,
    tool: options.tool ?? "safefs_watch",
    sessionId: options.sessionId,
  });

  return {
    snapshot: nextSnapshot,
    skipped: scan.skipped,
    skippedDetails: scan.skippedDetails,
    trackedBytes: scan.trackedBytes,
    events,
    pending: nextPending,
  };
}

async function recordStableChanges(options: {
  root: string;
  config: SafeFSConfig;
  stableChanges: WatchPendingChange[];
  nextSnapshot: WatchSnapshot;
  tool: string;
  sessionId?: string;
}): Promise<ExternalChangeResult[]> {
  const events: ExternalChangeResult[] = [];
  const consumed = new Set<string>();
  const deletes = options.stableChanges.filter((change) => change.before && !change.after);
  const creates = options.stableChanges.filter((change) => !change.before && change.after);

  for (const deleted of deletes) {
    const created = creates.find(
      (candidate) =>
        !consumed.has(candidate.path) &&
        candidate.after &&
        deleted.before &&
        candidate.after.hash === deleted.before.hash
    );
    if (!created || !deleted.before || !created.after) continue;

    const result = await recordExternalMove({
      root: options.root,
      fromPath: deleted.path,
      toPath: created.path,
      snapshot: created.after,
      tool: options.tool,
      reason: "Detected by SafeFS workspace watcher",
      sessionId: options.sessionId,
      config: options.config,
    });
    if (result.recorded) events.push(result);

    options.nextSnapshot.delete(deleted.path);
    options.nextSnapshot.set(created.path, created.after);
    consumed.add(deleted.path);
    consumed.add(created.path);
  }

  for (const change of options.stableChanges) {
    if (consumed.has(change.path)) continue;
    const result = await recordExternalChange({
      root: options.root,
      path: change.path,
      before: change.before,
      after: change.after,
      tool: options.tool,
      reason: "Detected by SafeFS workspace watcher",
      sessionId: options.sessionId,
      config: options.config,
    });
    if (result.recorded) events.push(result);
    applySnapshotChange(options.nextSnapshot, change.path, change.after);
  }

  return events;
}

async function scanDirectory(options: {
  root: string;
  directory: string;
  config: SafeFSConfig;
  previous?: WatchSnapshot;
  snapshot: WatchSnapshot;
  skippedDetails: WatchSkipDetail[];
  matchers: WatchMatchers;
  budget: { usedBytes: number; maxBytes: number };
  dryRun?: boolean;
}): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(options.directory, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES" || code === "EBUSY" || code === "ENOENT") {
      const relativePath = toPosixRelative(options.root, options.directory);
      if (relativePath) addSkip(options.skippedDetails, relativePath, `error:${code.toLowerCase()}`);
      return;
    }
    throw err;
  }

  for (const entry of entries) {
    const absolutePath = path.join(options.directory, entry.name);
    const relativePath = toPosixRelative(options.root, absolutePath);
    if (!relativePath) continue;

    if (entry.isDirectory()) {
      const skipReason = await shouldSkipPath(options.root, relativePath, options.config, options.matchers);
      if (skipReason) {
        addSkip(options.skippedDetails, relativePath, skipReason);
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

    const skipReason = await shouldSkipPath(options.root, relativePath, options.config, options.matchers);
    if (skipReason) {
      addSkip(options.skippedDetails, relativePath, skipReason);
      continue;
    }

    const previous = options.previous?.get(relativePath);
    try {
      const stat = await fs.stat(absolutePath);
      if (stat.size > options.config.watch.maxFileSizeMB * 1024 * 1024) {
        addSkip(options.skippedDetails, relativePath, "too-large");
        continue;
      }

      if (previous && previous.size === stat.size && previous.mtimeMs === stat.mtimeMs) {
        options.snapshot.set(relativePath, previous);
        options.budget.usedBytes += previous.size;
        continue;
      }

      if (options.budget.usedBytes + stat.size > options.budget.maxBytes) {
        addSkip(options.skippedDetails, relativePath, "snapshot-budget");
        continue;
      }

      const fileSnapshot = await snapshotFileForExternalTracking({
        root: options.root,
        path: relativePath,
        config: options.config,
        maxFileSizeMB: options.config.watch.maxFileSizeMB,
        skipBinary: true,
        dryRun: options.dryRun,
      });

      if (fileSnapshot) {
        options.snapshot.set(relativePath, fileSnapshot);
        options.budget.usedBytes += fileSnapshot.size;
      }
    } catch (err) {
      if (isSkippableSafeFSError(err)) {
        addSkip(options.skippedDetails, relativePath, (err as SafeFSError).code.toLowerCase());
        continue;
      }
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EACCES" || code === "EBUSY" || code === "ENOENT") {
        addSkip(options.skippedDetails, relativePath, `error:${code.toLowerCase()}`);
        continue;
      }
      throw err;
    }
  }
}

async function shouldSkipPath(
  root: string,
  relativePath: string,
  config: SafeFSConfig,
  matchers: WatchMatchers
): Promise<string | undefined> {
  if (matchers.exclude.some((matcher) => matcher(relativePath))) {
    return "excluded";
  }

  try {
    await resolveSafePath({
      root,
      requestedPath: relativePath,
      config,
    });
    return undefined;
  } catch (err) {
    if (isSkippableSafeFSError(err)) return (err as SafeFSError).code.toLowerCase();
    throw err;
  }
}


function createMatchersForPattern(pattern: string): Array<(value: string) => boolean> {
  const normalized = pattern.split(path.sep).join("/");
  const withoutLeadingSlash = normalized.startsWith("/") ? normalized.slice(1) : normalized;
  const directoryPattern = withoutLeadingSlash.endsWith("/")
    ? `${withoutLeadingSlash}**`
    : withoutLeadingSlash;
  const variants = directoryPattern.includes("/")
    ? [directoryPattern]
    : [directoryPattern, `**/${directoryPattern}`];

  return variants.map((variant) => picomatch(variant, { dot: true }));
}

function isSkippableSafeFSError(err: unknown): boolean {
  return (
    err instanceof SafeFSError &&
    (err.code === "PROTECTED_PATH" ||
      err.code === "SAFEFS_INTERNAL_ACCESS" ||
      err.code === "FILE_TOO_LARGE" ||
      err.code === "BINARY_FILE_SKIPPED")
  );
}

function applySnapshotChange(
  snapshot: WatchSnapshot,
  filePath: string,
  after: FileSnapshot | null
): void {
  if (after) {
    snapshot.set(filePath, after);
  } else {
    snapshot.delete(filePath);
  }
}

function createChangeSignature(before: FileSnapshot | null, after: FileSnapshot | null): string {
  return `${before?.hash ?? "missing"}->${after?.hash ?? "missing"}`;
}

function addSkip(skippedDetails: WatchSkipDetail[], filePath: string, reason: string): void {
  skippedDetails.push({ path: filePath, reason });
}

function toPosixRelative(root: string, absolutePath: string): string {
  const relative = path.relative(root, absolutePath);
  return relative.split(path.sep).join("/");
}
