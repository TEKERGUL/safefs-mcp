import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import picomatch from "picomatch";
import {
  recordExternalChange,
  recordExternalMove,
  snapshotFileForExternalTracking,
} from "./externalChangeRecorder.js";
import { resolveSafePath } from "./pathSafety.js";
import { loadSuppressionState, isPathSuppressedBy } from "./suppression.js";
import { detectFsCapabilities } from "./fsCapabilities.js";
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
  deferredCount: number;
  warnings: string[];
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

  const key = `${JSON.stringify(patterns)}\0${gitignoreContent}`;
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
  const capabilities = await detectFsCapabilities(root, { writeCache: !options.dryRun });
  const matchers = await getOrCreateWatchMatchers(root, options.config);
  const budget = {
    usedBytes: 0,
    maxBytes: options.config.watch.maxSnapshotBytesMB * 1024 * 1024,
  };
  const caseTracking = {
    caseSensitive: capabilities.caseSensitive,
    keys: new Map<string, string>(),
    collisions: new Set<string>(),
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
    caseTracking,
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
  flush?: boolean;
}): Promise<WatchCycleResult> {
  const nowMs = options.nowMs ?? Date.now();
  const stableMs = options.stableMs ?? options.config.watch.debounceMs;
  const scan = await scanWorkspaceForWatch({
    root: options.root,
    config: options.config,
    previous: options.previous,
  });
  const paths = new Set([
    ...options.previous.keys(),
    ...scan.snapshot.keys(),
    ...(options.pending?.keys() ?? []),
  ]);
  const nextPending: WatchPendingChanges = new Map();
  const stableChanges: WatchPendingChange[] = [];
  const nextSnapshot: WatchSnapshot = new Map(options.previous);
  const suppression = await loadSuppressionState(options.root);

  for (const filePath of [...paths].sort()) {
    const existing = options.pending?.get(filePath);
    const before = existing?.before ?? options.previous.get(filePath) ?? null;
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

  const deferredChanges = deferDeletesForMoveDetection({
    stableChanges,
    nextPending,
    nowMs,
    stableMs,
    moveDetectionWindowMs: options.config.watch.moveDetectionWindowMs,
    flush: options.flush ?? false,
  });

  const limited = applyCycleRateLimit({
    changes: deferredChanges,
    nextPending,
    maxEventsPerCycle: options.config.watch.maxEventsPerCycle,
  });

  const events = await recordStableChanges({
    root: options.root,
    config: options.config,
    stableChanges: limited.recordable,
    nextSnapshot,
    tool: options.tool ?? "safefs_watch",
    sessionId: options.sessionId,
  });

  const warnings = [...limited.warnings];
  if (nextPending.size >= options.config.watch.maxPendingChangesWarning) {
    warnings.push(
      `Pending watch changes reached ${nextPending.size} (threshold: ${options.config.watch.maxPendingChangesWarning}).`
    );
  }

  return {
    snapshot: nextSnapshot,
    skipped: scan.skipped,
    skippedDetails: scan.skippedDetails,
    trackedBytes: scan.trackedBytes,
    events,
    pending: nextPending,
    deferredCount: limited.deferredCount,
    warnings,
  };
}

function applyCycleRateLimit(options: {
  changes: WatchPendingChange[];
  nextPending: WatchPendingChanges;
  maxEventsPerCycle: number;
}): { recordable: WatchPendingChange[]; deferredCount: number; warnings: string[] } {
  if (options.changes.length <= options.maxEventsPerCycle) {
    return { recordable: options.changes, deferredCount: 0, warnings: [] };
  }

  const recordable = options.changes.slice(0, options.maxEventsPerCycle);
  const deferred = options.changes.slice(options.maxEventsPerCycle);
  for (const change of deferred) {
    options.nextPending.set(change.path, change);
  }

  return {
    recordable,
    deferredCount: deferred.length,
    warnings: [
      `Recorded ${recordable.length} watch changes and deferred ${deferred.length} to avoid a large event burst.`,
    ],
  };
}

function deferDeletesForMoveDetection(options: {
  stableChanges: WatchPendingChange[];
  nextPending: WatchPendingChanges;
  nowMs: number;
  stableMs: number;
  moveDetectionWindowMs: number;
  flush: boolean;
}): WatchPendingChange[] {
  if (options.flush || options.moveDetectionWindowMs <= 0) {
    return options.stableChanges;
  }

  const creates = options.stableChanges.filter((change) => !change.before && change.after);
  const recordable: WatchPendingChange[] = [];

  for (const change of options.stableChanges) {
    const isDelete = change.before && !change.after;
    if (!isDelete) {
      recordable.push(change);
      continue;
    }

    const hasMatchingCreate = creates.some(
      (candidate) => candidate.after?.hash === change.before?.hash
    );
    const ageMs = options.nowMs - change.firstSeenMs;
    if (!hasMatchingCreate && ageMs < options.stableMs + options.moveDetectionWindowMs) {
      options.nextPending.set(change.path, change);
      continue;
    }

    recordable.push(change);
  }

  return recordable;
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
  caseTracking: {
    caseSensitive: boolean;
    keys: Map<string, string>;
    collisions: Set<string>;
  };
  dryRun?: boolean;
}): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(options.directory, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES" || code === "EBUSY" || code === "ENOENT") {
      const relativePath = toPosixRelative(options.root, options.directory);
      if (relativePath) addSkip(options.skippedDetails, relativePath, mapFsErrorReason(code) ?? `error:${code.toLowerCase()}`);
      return;
    }
    throw err;
  }

  for (const entry of entries) {
    const absolutePath = path.join(options.directory, entry.name);
    const relativePath = toPosixRelative(options.root, absolutePath);
    if (!relativePath) continue;

    if (!registerCasePath(options, relativePath)) {
      addSkip(options.skippedDetails, relativePath, "case-collision");
      continue;
    }

    if (entry.isSymbolicLink()) {
      if (!options.config.workspace.followSymlinks) {
        addSkip(options.skippedDetails, relativePath, "symlink");
        continue;
      }

      const skipReason = await shouldSkipPath(options.root, relativePath, options.config, options.matchers);
      if (skipReason) {
        addSkip(options.skippedDetails, relativePath, skipReason);
        continue;
      }

      const targetSkipReason = await getSymlinkTargetSkipReason(
        options.root,
        absolutePath,
        options.config,
        options.matchers
      );
      if (targetSkipReason) {
        addSkip(options.skippedDetails, relativePath, targetSkipReason);
        continue;
      }

      try {
        const stat = await fs.stat(absolutePath);
        if (stat.isDirectory()) {
          await scanDirectory({ ...options, directory: absolutePath });
          continue;
        }
        if (stat.isFile()) {
          await scanFile(options, absolutePath, relativePath, stat);
        }
      } catch (err) {
        if (handleSkippableFsError(options.skippedDetails, relativePath, err)) continue;
        throw err;
      }
      continue;
    }

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

    try {
      await scanFile(options, absolutePath, relativePath);
    } catch (err) {
      if (handleSkippableFsError(options.skippedDetails, relativePath, err)) continue;
      throw err;
    }
  }
}

async function getSymlinkTargetSkipReason(
  root: string,
  absolutePath: string,
  config: SafeFSConfig,
  matchers: WatchMatchers
): Promise<string | undefined> {
  try {
    const [realRoot, realPath] = await Promise.all([
      fs.realpath(root),
      fs.realpath(absolutePath),
    ]);
    const relativePath = path.relative(realRoot, realPath);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      return "path_outside_root";
    }

    const posixRelative = relativePath.split(path.sep).join("/");
    if (!posixRelative) return undefined;
    return await shouldSkipPath(root, posixRelative, config, matchers);
  } catch (err) {
    if (err instanceof SafeFSError) return err.code.toLowerCase();
    return mapFsErrorReason((err as NodeJS.ErrnoException).code);
  }
}

async function scanFile(
  options: {
    root: string;
    config: SafeFSConfig;
    previous?: WatchSnapshot;
    snapshot: WatchSnapshot;
    skippedDetails: WatchSkipDetail[];
    budget: { usedBytes: number; maxBytes: number };
    dryRun?: boolean;
  },
  absolutePath: string,
  relativePath: string,
  existingStat?: { size: number; mtimeMs: number }
): Promise<void> {
  const previous = options.previous?.get(relativePath);
  const stat = existingStat ?? await fs.stat(absolutePath);
  if (stat.size > options.config.watch.maxFileSizeMB * 1024 * 1024) {
    addSkip(options.skippedDetails, relativePath, "too-large");
    return;
  }

  if (previous && previous.size === stat.size && previous.mtimeMs === stat.mtimeMs) {
    options.snapshot.set(relativePath, previous);
    options.budget.usedBytes += previous.size;
    return;
  }

  if (options.budget.usedBytes + stat.size > options.budget.maxBytes) {
    addSkip(options.skippedDetails, relativePath, "snapshot-budget");
    return;
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
}

function registerCasePath(
  options: {
    snapshot: WatchSnapshot;
    skippedDetails: WatchSkipDetail[];
    caseTracking: {
      caseSensitive: boolean;
      keys: Map<string, string>;
      collisions: Set<string>;
    };
  },
  relativePath: string
): boolean {
  if (options.caseTracking.caseSensitive) return true;

  const key = relativePath.toLowerCase();
  const existing = options.caseTracking.keys.get(key);
  if (existing && existing !== relativePath) {
    options.caseTracking.collisions.add(existing);
    options.caseTracking.collisions.add(relativePath);
    options.snapshot.delete(existing);
    addSkip(options.skippedDetails, existing, "case-collision");
    return false;
  }

  options.caseTracking.keys.set(key, relativePath);
  return !options.caseTracking.collisions.has(relativePath);
}

function handleSkippableFsError(
  skippedDetails: WatchSkipDetail[],
  relativePath: string,
  err: unknown
): boolean {
  if (isSkippableSafeFSError(err)) {
    addSkip(skippedDetails, relativePath, (err as SafeFSError).code.toLowerCase());
    return true;
  }

  const reason = mapFsErrorReason((err as NodeJS.ErrnoException).code);
  if (reason) {
    addSkip(skippedDetails, relativePath, reason);
    return true;
  }

  return false;
}

function mapFsErrorReason(code: string | undefined): string | undefined {
  switch (code) {
    case "EPERM":
    case "EACCES":
      return "permission-denied";
    case "EBUSY":
      return "busy";
    case "ENOENT":
      return "missing-during-scan";
    default:
      return undefined;
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
