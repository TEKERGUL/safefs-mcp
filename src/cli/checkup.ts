import path from "node:path";
import { loadConfig } from "../config/loadConfig.js";
import { getFullStorageStatus } from "../core/storageStats.js";

export interface CheckupCheck {
  name: string;
  status: "pass" | "warn";
  message: string;
}

export interface CheckupResult {
  success: true;
  ok: boolean;
  generatedAt: string;
  root: string;
  checks: CheckupCheck[];
  storage: {
    eventCount: number;
    timelineSizeBytes: number;
    timelineApproxSize: string;
    objectCount: number;
    objectStoreBytes: number;
    objectApproxSize: string;
    compressionEnabled: boolean;
    oldestEvent?: string;
    newestEvent?: string;
    thresholds: {
      maxTimelineBytes: number;
      maxObjectStoreBytes: number;
      maxTimelineEvents: number;
      retentionDays: number;
    };
  };
  watch: {
    intervalMs: number;
    debounceMs: number;
    maxEventsPerCycle: number;
    maxPendingChangesWarning: number;
    binaryPolicy: "skip";
  };
  warnings: string[];
  recommendations: string[];
}

export async function runCheckup(
  root: string,
  options: { json?: boolean; strict?: boolean } = {}
): Promise<CheckupResult> {
  const normalizedRoot = path.resolve(root);
  const config = await loadConfig(normalizedRoot);
  const storage = await getFullStorageStatus(normalizedRoot, config);
  const checks: CheckupCheck[] = [
    {
      name: "storage",
      status: storage.warnings.length > 0 ? "warn" : "pass",
      message:
        storage.warnings.length > 0
          ? `${storage.warnings.length} storage warning(s) found.`
          : "Timeline and object store are within configured limits.",
    },
    {
      name: "compression",
      status: "pass",
      message: `Object compression is ${config.storage.objectCompression ? "enabled" : "disabled"}.`,
    },
    {
      name: "watch-rate-limit",
      status: "pass",
      message: `Watch records up to ${config.watch.maxEventsPerCycle} event(s) per cycle and warns at ${config.watch.maxPendingChangesWarning} pending change(s).`,
    },
    {
      name: "binary-policy",
      status: "pass",
      message: "Watch mode skips binary files by default; text rollback remains the primary path.",
    },
  ];

  const recommendations =
    storage.recommendations.length > 0
      ? storage.recommendations
      : [
          `Preview cleanup with \`safefs prune --days ${config.storage.retentionDays}\`.`,
          "Run `safefs gc --yes` to remove unreferenced objects after reviewing storage.",
        ];

  const result: CheckupResult = {
    success: true,
    ok: checks.every((check) => check.status === "pass"),
    generatedAt: new Date().toISOString(),
    root: normalizedRoot,
    checks,
    storage: {
      eventCount: storage.eventCount,
      timelineSizeBytes: storage.timelineSizeBytes,
      timelineApproxSize: storage.timelineApproxSize,
      objectCount: storage.objectCount,
      objectStoreBytes: storage.totalObjectSizeBytes,
      objectApproxSize: storage.approximateSize,
      compressionEnabled: storage.compressionEnabled,
      oldestEvent: storage.oldestEvent,
      newestEvent: storage.newestEvent,
      thresholds: storage.thresholds,
    },
    watch: {
      intervalMs: config.watch.intervalMs,
      debounceMs: config.watch.debounceMs,
      maxEventsPerCycle: config.watch.maxEventsPerCycle,
      maxPendingChangesWarning: config.watch.maxPendingChangesWarning,
      binaryPolicy: "skip",
    },
    warnings: storage.warnings,
    recommendations,
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printCheckup(result);
  }

  if (options.strict && !result.ok) {
    process.exitCode = 1;
  }

  return result;
}

function printCheckup(result: CheckupResult): void {
  console.log("SafeFS project check-up");
  console.log("");
  console.log(`Root: ${result.root}`);
  console.log(`Status: ${result.ok ? "pass" : "warn"}`);
  console.log("");
  console.log("Storage:");
  console.log(`  Events:       ${result.storage.eventCount}`);
  console.log(`  Timeline:     ${result.storage.timelineApproxSize}`);
  console.log(`  Objects:      ${result.storage.objectCount}`);
  console.log(`  Object size:  ${result.storage.objectApproxSize}`);
  console.log(`  Compression:  ${result.storage.compressionEnabled ? "enabled" : "disabled"}`);
  console.log("");
  console.log("Watch:");
  console.log(`  Interval:      ${result.watch.intervalMs}ms`);
  console.log(`  Debounce:      ${result.watch.debounceMs}ms`);
  console.log(`  Cycle limit:   ${result.watch.maxEventsPerCycle}`);
  console.log(`  Pending warn:  ${result.watch.maxPendingChangesWarning}`);
  console.log("  Binary policy: skip");

  if (result.warnings.length > 0) {
    console.log("");
    console.log("Warnings:");
    for (const warning of result.warnings) {
      console.log(`  WARN ${warning}`);
    }
  }

  console.log("");
  console.log("Recommendations:");
  for (const recommendation of result.recommendations) {
    console.log(`  - ${recommendation}`);
  }
}
