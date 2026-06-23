import path from "node:path";
import { loadConfig } from "../config/loadConfig.js";
import { detectWorkspaceChanges, scanWorkspaceForWatch } from "../core/watch.js";
import { loadWatchManifest, saveWatchManifest } from "../core/watchManifest.js";
import { generateSessionId } from "../core/workspace.js";
import type { WatchPendingChanges, WatchSkipDetail, WatchSnapshot } from "../core/watch.js";

export interface WatchOptions {
  intervalMs?: number;
  once?: boolean;
  dryRun?: boolean;
  quiet?: boolean;
}

export interface WatchHandle {
  stop: () => Promise<void>;
  snapshot: () => WatchSnapshot;
}

export async function runWatch(
  root: string,
  options: WatchOptions = {}
): Promise<void> {
  const handle = await startWatch(root, options);

  if (options.once || options.dryRun) {
    await handle.stop();
    return;
  }

  await new Promise<void>((resolve) => {
    process.once("SIGINT", () => {
      void handle.stop().then(() => {
        resolve();
      });
    });
  });
}

export async function startWatch(
  root: string,
  options: WatchOptions = {}
): Promise<WatchHandle> {
  const normalizedRoot = path.resolve(root);
  const config = await loadConfig(normalizedRoot);
  const intervalMs = options.intervalMs ?? config.watch.intervalMs;
  const sessionId = generateSessionId();
  const manifest = options.dryRun ? new Map() : await loadWatchManifest(normalizedRoot);
  const baseline = await scanWorkspaceForWatch({
    root: normalizedRoot,
    config,
    previous: manifest,
    dryRun: options.dryRun,
  });
  let current: WatchSnapshot = baseline.snapshot;
  let pending: WatchPendingChanges = new Map();
  let running = false;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  if (!options.dryRun) {
    await saveWatchManifest(normalizedRoot, current);
  }

  if (!options.quiet) {
    printWatchStart({
      root: normalizedRoot,
      trackedFiles: current.size,
      trackedBytes: baseline.trackedBytes,
      skippedDetails: baseline.skippedDetails,
      intervalMs,
      dryRun: options.dryRun,
    });
  }

  const runCycle = async (force = false): Promise<void> => {
    if (running || (stopped && !force)) return;
    running = true;
    try {
      const result = await detectWorkspaceChanges({
        root: normalizedRoot,
        config,
        previous: current,
        pending,
        sessionId,
        stableMs: force ? 0 : undefined,
        flush: force,
      });
      current = result.snapshot;
      pending = result.pending;
      if (!options.dryRun) {
        await saveWatchManifest(normalizedRoot, current);
      }

      if (!options.quiet) {
        for (const warning of result.warnings) {
          console.warn(`  warning ${warning}`);
        }
        for (const event of result.events) {
          console.log(`  ${event.operation?.padEnd(6)} ${event.path} (${event.eventId})`);
        }
      }
    } catch (err) {
      if (!options.quiet) {
        console.error(`SafeFS watch warning: ${(err as Error).message}`);
      }
    } finally {
      running = false;
    }
  };

  if (!options.once && !options.dryRun) {
    timer = setInterval(() => {
      void runCycle();
    }, intervalMs);
  }

  return {
    stop: async () => {
      if (stopped) return;
      if (timer) clearInterval(timer);
      while (running) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (!options.dryRun) {
        await runCycle(true);
      }
      stopped = true;
      if (!options.dryRun) {
        await saveWatchManifest(normalizedRoot, current);
      }
      if (!options.quiet && !options.once && !options.dryRun) {
        console.log("");
        console.log("SafeFS watch stopped.");
      }
    },
    snapshot: () => current,
  };
}

function printWatchStart(options: {
  root: string;
  trackedFiles: number;
  trackedBytes: number;
  skippedDetails: WatchSkipDetail[];
  intervalMs: number;
  dryRun?: boolean;
}): void {
  const skipped = countSkipReasons(options.skippedDetails);
  console.log(options.dryRun ? "SafeFS watch dry run." : "SafeFS watch started.");
  console.log(`Root: ${options.root}`);
  console.log(`Tracked files: ${options.trackedFiles}`);
  console.log(`Estimated storage: ${formatBytes(options.trackedBytes)}`);
  console.log(`Skipped files/dirs: ${options.skippedDetails.length}`);
  console.log(`Protected skips: ${skipped.protected}`);
  console.log(`Too-large skips: ${skipped.tooLarge}`);
  console.log(`Binary skips: ${skipped.binary}`);
  console.log(`Excluded skips: ${skipped.excluded}`);
  console.log(`Interval: ${options.intervalMs}ms`);
  if (!options.dryRun) {
    console.log("Press Ctrl+C to stop.");
  }
}

function countSkipReasons(skippedDetails: WatchSkipDetail[]): {
  protected: number;
  tooLarge: number;
  binary: number;
  excluded: number;
} {
  let protectedCount = 0;
  let tooLarge = 0;
  let binary = 0;
  let excluded = 0;

  for (const item of skippedDetails) {
    if (item.reason === "excluded") excluded++;
    if (item.reason === "binary_file_skipped") binary++;
    if (item.reason === "too-large" || item.reason === "file_too_large") tooLarge++;
    if (item.reason === "protected_path" || item.reason === "safefs_internal_access") {
      protectedCount++;
    }
  }

  return { protected: protectedCount, tooLarge, binary, excluded };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
