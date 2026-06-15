import { queryEvents } from "../core/timeline.js";
import { parseTimeInput } from "../core/timeParser.js";
import { getStorageStats } from "../core/objectStore.js";
import type { SafeFSConfig, TimelineEvent } from "../types/index.js";

export interface TimelineSummary {
  totalEvents: number;
  changedFiles: string[];
  operations: Record<string, number>;
  riskBreakdown: Record<string, number>;
  storageUsedBytes: number;
  oldestEvent?: string;
  newestEvent?: string;
}

export interface TimelineResult {
  success: true;
  events: TimelineEvent[];
  summary: TimelineSummary;
}

export async function safeTimeline(options: {
  root: string;
  since?: string;
  until?: string;
  path?: string;
  sessionId?: string;
  limit?: number;
  config: SafeFSConfig;
}): Promise<TimelineResult> {
  const { root } = options;

  const since = options.since ? parseTimeInput(options.since) : undefined;
  const until = options.until ? parseTimeInput(options.until) : undefined;

  const events = await queryEvents(root, {
    since,
    until,
    path: options.path,
    sessionId: options.sessionId,
    limit: options.limit,
  });

  const changedFiles = [...new Set(events.map((e) => e.path))];
  const operations: Record<string, number> = {};
  const riskBreakdown: Record<string, number> = {};

  for (const event of events) {
    operations[event.operation] = (operations[event.operation] ?? 0) + 1;
    riskBreakdown[event.risk] = (riskBreakdown[event.risk] ?? 0) + 1;
  }

  const stats = await getStorageStats(root);

  const summary: TimelineSummary = {
    totalEvents: events.length,
    changedFiles,
    operations,
    riskBreakdown,
    storageUsedBytes: stats.totalObjectSizeBytes,
    oldestEvent: events.length > 0 ? events[0]!.timestamp : undefined,
    newestEvent:
      events.length > 0 ? events[events.length - 1]!.timestamp : undefined,
  };

  return {
    success: true,
    events,
    summary,
  };
}
