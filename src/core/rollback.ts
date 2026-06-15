import fs from "node:fs/promises";
import { parseTimeInput } from "./timeParser.js";
import { queryEvents, appendEvent, generateEventId } from "./timeline.js";
import { loadObject } from "./objectStore.js";
import { detectConflict } from "./conflict.js";
import { resolveSafePath } from "./pathSafety.js";
import { atomicWriteFile, fileExists } from "./workspace.js";
import type {
  SafeFSConfig,
  RollbackResult,
  TimelineEvent,
  ConflictDetail,
  RollbackPlanItem,
} from "../types/index.js";

export interface PlannedRollback {
  item: RollbackPlanItem;
  events: TimelineEvent[];
  earliestEvent: TimelineEvent;
  latestEvent: TimelineEvent;
  absolutePath: string;
}

export interface RollbackPlan {
  planned: PlannedRollback[];
  skipped: string[];
  conflicts: ConflictDetail[];
}

export async function rollbackSince(options: {
  root: string;
  since: string;
  path?: string;
  dryRun?: boolean;
  confirm?: boolean;
  config: SafeFSConfig;
}): Promise<RollbackResult> {
  const { root, since } = options;

  const effectiveDryRun =
    options.dryRun !== false || options.confirm !== true;

  const rollbackPlan = await planRollbackSince({
    root,
    since,
    path: options.path,
    config: options.config,
  });

  if (rollbackPlan.planned.length === 0) {
    return {
      success: true,
      dryRun: effectiveDryRun,
      planned: [],
      plannedActions: [],
      reverted: [],
      skipped: rollbackPlan.skipped,
      conflicts: rollbackPlan.conflicts,
    };
  }

  const reverted: string[] = [];
  const skipped = [...rollbackPlan.skipped];
  const allRevertedEventIds: string[] = [];

  if (effectiveDryRun) {
    return {
      success: true,
      dryRun: effectiveDryRun,
      planned: rollbackPlan.planned.map((plan) => plan.item.path),
      plannedActions: rollbackPlan.planned.map((plan) => plan.item),
      reverted,
      skipped,
      conflicts: rollbackPlan.conflicts,
    };
  }

  for (const plan of rollbackPlan.planned) {
    try {
      if (plan.item.action === "restore" && plan.earliestEvent.beforeObject) {
        const content = await loadObject(root, plan.earliestEvent.beforeObject);
        await atomicWriteFile(plan.absolutePath, content);
      } else if (await fileExists(plan.absolutePath)) {
        await fs.unlink(plan.absolutePath);
      }
      reverted.push(plan.item.path);
      allRevertedEventIds.push(...plan.item.eventIds);
    } catch {
      skipped.push(plan.item.path);
    }
  }

  let rollbackEventId: string | undefined;

  if (!effectiveDryRun && reverted.length > 0) {
    rollbackEventId = generateEventId();
    const rollbackEvent: TimelineEvent = {
      eventId: rollbackEventId,
      timestamp: new Date().toISOString(),
      actor: "user",
      tool: "safe_rollback_time",
      operation: "rollback",
      path: reverted.length === 1 ? reverted[0]! : "*",
      risk: "medium",
      committed: true,
      status: "committed",
      rollbackOf: allRevertedEventIds,
    };
    await appendEvent(root, rollbackEvent);
  }

  return {
    success: true,
    dryRun: effectiveDryRun,
    planned: [],
    plannedActions: rollbackPlan.planned.map((plan) => plan.item),
    reverted,
    skipped,
    conflicts: rollbackPlan.conflicts,
    rollbackEventId,
  };
}

export async function planRollbackSince(options: {
  root: string;
  since: string;
  path?: string;
  config: SafeFSConfig;
}): Promise<RollbackPlan> {
  const { root, since, config } = options;
  const cutoffTime = parseTimeInput(since);
  const normalizedPath = options.path
    ? (
        await resolveSafePath({
          root,
          requestedPath: options.path,
          config,
        })
      ).relativePath
    : undefined;

  const events = await queryEvents(root, {
    since: cutoffTime,
    path: normalizedPath,
  });

  const committedMutations = events.filter(isCommittedMutation);
  const grouped = new Map<string, TimelineEvent[]>();

  for (const event of committedMutations) {
    const existing = grouped.get(event.path) ?? [];
    existing.push(event);
    grouped.set(event.path, existing);
  }

  const planned: PlannedRollback[] = [];
  const skipped: string[] = [];
  const conflicts: ConflictDetail[] = [];

  for (const [filePath, pathEvents] of grouped) {
    const resolved = await resolveSafePath({
      root,
      requestedPath: filePath,
      config,
    });
    const sorted = [...pathEvents].sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    const earliestEvent = sorted[0]!;
    const latestEvent = sorted[sorted.length - 1]!;
    const conflict = await detectConflict(resolved.absolutePath, latestEvent);

    if (conflict) {
      conflicts.push(conflict);
      skipped.push(filePath);
      continue;
    }

    planned.push({
      item: {
        path: resolved.relativePath,
        action: earliestEvent.beforeObject ? "restore" : "delete_created",
        eventIds: sorted.map((event) => event.eventId),
        beforeHash: earliestEvent.beforeHash ?? null,
        afterHash: latestEvent.afterHash ?? null,
      },
      events: sorted,
      earliestEvent,
      latestEvent,
      absolutePath: resolved.absolutePath,
    });
  }

  return {
    planned,
    skipped,
    conflicts,
  };
}

function isCommittedMutation(event: TimelineEvent): boolean {
  const committedByStatus =
    event.status === undefined ? event.committed : event.status === "committed";

  return (
    committedByStatus &&
    event.committed &&
    (event.operation === "write" ||
      event.operation === "patch" ||
      event.operation === "delete")
  );
}
