import { safeStorageStatus } from "../tools/safeStorageStatus.js";
import { loadConfig } from "../config/loadConfig.js";

export async function runStorage(root: string): Promise<void> {
  const config = await loadConfig(root);
  const result = await safeStorageStatus(root, config);

  console.log("SafeFS storage status");
  console.log("");
  console.log(`  Events:       ${result.eventCount}`);
  console.log(`  Objects:      ${result.objectCount}`);
  console.log(`  Total size:   ${result.approximateSize}`);
  if (result.oldestEvent) {
    console.log(`  Oldest event: ${result.oldestEvent}`);
  }
  if (result.newestEvent) {
    console.log(`  Newest event: ${result.newestEvent}`);
  }

  if (result.warnings.length > 0) {
    console.log("");
    console.log("Warnings:");
    for (const warning of result.warnings) {
      console.log(`  ⚠ ${warning}`);
    }
  }

  if (result.recommendations.length > 0) {
    console.log("");
    console.log("Recommendations:");
    for (const rec of result.recommendations) {
      console.log(`  → ${rec}`);
    }
  }
}
