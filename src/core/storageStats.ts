import { getStorageStats } from "./objectStore.js";
import { getEventCount, getTimelineBounds, getTimelineSizeBytes } from "./timeline.js";
import type { SafeFSConfig } from "../types/index.js";

export interface FullStorageStatus {
  success: true;
  eventCount: number;
  timelineSizeBytes: number;
  timelineApproxSize: string;
  objectCount: number;
  totalObjectSizeBytes: number;
  approximateSize: string;
  oldestEvent?: string;
  newestEvent?: string;
  compressionEnabled: boolean;
  thresholds: {
    maxTimelineBytes: number;
    maxObjectStoreBytes: number;
    maxTimelineEvents: number;
    retentionDays: number;
  };
  warnings: string[];
  recommendations: string[];
}

export async function getFullStorageStatus(
  root: string,
  config: SafeFSConfig
): Promise<FullStorageStatus> {
  const stats = await getStorageStats(root);
  const eventCount = await getEventCount(root);
  const timelineSizeBytes = await getTimelineSizeBytes(root);

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
      `Preview old-event cleanup with \`safefs prune --days ${config.storage.retentionDays}\`.`
    );
  }

  const maxTimelineBytes = config.storage.maxTimelineBytesMB * 1024 * 1024;
  if (timelineSizeBytes >= maxTimelineBytes) {
    warnings.push(
      `Timeline file is ${formatBytes(timelineSizeBytes)} (threshold: ${config.storage.maxTimelineBytesMB}MB).`
    );
    recommendations.push(
      `Run \`safefs prune --days ${config.storage.retentionDays} --yes --gc\` after reviewing the dry run.`
    );
  }

  const maxObjectStoreBytes = config.storage.maxObjectStoreBytesMB * 1024 * 1024;
  if (stats.totalObjectSizeBytes >= maxObjectStoreBytes) {
    warnings.push(
      `Object store is ${stats.approximateSize} (threshold: ${config.storage.maxObjectStoreBytesMB}MB).`
    );
    recommendations.push(
      "Run `safefs gc --yes` to remove unreferenced objects, or prune old timeline events first."
    );
  }

  if (oldestEvent) {
    const oldest = new Date(oldestEvent);
    const daysOld = (Date.now() - oldest.getTime()) / (1000 * 60 * 60 * 24);
    if (daysOld > config.storage.retentionWarningDays) {
      warnings.push(
        `Oldest event is ${Math.floor(daysOld)} days old (threshold: ${config.storage.retentionWarningDays} days).`
      );
      recommendations.push(
        `Preview old-event cleanup with \`safefs prune --days ${config.storage.retentionDays}\`.`
      );
    }
  }

  return {
    success: true,
    eventCount,
    timelineSizeBytes,
    timelineApproxSize: formatBytes(timelineSizeBytes),
    objectCount: stats.objectCount,
    totalObjectSizeBytes: stats.totalObjectSizeBytes,
    approximateSize: stats.approximateSize,
    oldestEvent,
    newestEvent,
    compressionEnabled: config.storage.objectCompression,
    thresholds: {
      maxTimelineBytes,
      maxObjectStoreBytes,
      maxTimelineEvents: config.limits.maxTimelineEventsWarning,
      retentionDays: config.storage.retentionDays,
    },
    warnings,
    recommendations: [...new Set(recommendations)],
  };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
