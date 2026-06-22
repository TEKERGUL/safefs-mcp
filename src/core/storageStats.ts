import { getStorageStats } from "./objectStore.js";
import { getEventCount, getTimelineBounds } from "./timeline.js";
import type { SafeFSConfig } from "../types/index.js";

export interface FullStorageStatus {
  success: true;
  eventCount: number;
  objectCount: number;
  totalObjectSizeBytes: number;
  approximateSize: string;
  oldestEvent?: string;
  newestEvent?: string;
  warnings: string[];
  recommendations: string[];
}

export async function getFullStorageStatus(
  root: string,
  config: SafeFSConfig
): Promise<FullStorageStatus> {
  const stats = await getStorageStats(root);
  const eventCount = await getEventCount(root);

  const bounds = await getTimelineBounds(root);
  const oldestEvent = bounds.oldest;
  const newestEvent = bounds.newest;

  const warnings: string[] = [];
  const recommendations: string[] = [];

  if (eventCount >= config.limits.maxTimelineEventsWarning) {
    warnings.push(
      `Timeline has ${eventCount} events (threshold: ${config.limits.maxTimelineEventsWarning}).`
    );
    recommendations.push(
      "Consider archiving old timeline events in a future version."
    );
  }

  if (stats.totalObjectSizeBytes > 500 * 1024 * 1024) {
    warnings.push(
      `Object store is large: ${stats.approximateSize}.`
    );
    recommendations.push(
      "Review stored objects and consider pruning old snapshots."
    );
  }

  if (oldestEvent) {
    const oldest = new Date(oldestEvent);
    const daysOld = (Date.now() - oldest.getTime()) / (1000 * 60 * 60 * 24);
    if (daysOld > config.storage.retentionWarningDays) {
      warnings.push(
        `Oldest event is ${Math.floor(daysOld)} days old (threshold: ${config.storage.retentionWarningDays} days).`
      );
    }
  }

  return {
    success: true,
    eventCount,
    objectCount: stats.objectCount,
    totalObjectSizeBytes: stats.totalObjectSizeBytes,
    approximateSize: stats.approximateSize,
    oldestEvent,
    newestEvent,
    warnings,
    recommendations,
  };
}
