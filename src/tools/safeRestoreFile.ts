import fs from "node:fs/promises";
import { appendEvent, generateEventId, queryEvents } from "../core/timeline.js";
import { loadObject } from "../core/objectStore.js";
import { resolveSafePath } from "../core/pathSafety.js";
import { createRollbackSuppression } from "../core/suppression.js";
import { sha256File } from "../core/hash.js";
import { atomicWriteFile, fileExists } from "../core/workspace.js";
import type {
  ConflictDetail,
  RestoreFileActionType,
  RestoreFileResult,
  SafeFSConfig,
  TimelineEvent,
} from "../types/index.js";
import { SafeFSError } from "../types/index.js";

export async function safeRestoreFile(options: {
  root: string;
  path: string;
  checkpointId?: string;
  dryRun?: boolean;
  confirm?: boolean;
  config: SafeFSConfig;
}): Promise<RestoreFileResult> {
  const root = options.root;
  const resolved = await resolveSafePath({
    root,
    requestedPath: options.path,
    config: options.config,
  });
  const events = await getCommittedMutationsForPath(root, resolved.relativePath);
  if (events.length === 0) {
    throw new SafeFSError(
      "NO_RESTORE_CHECKPOINT",
      `No committed SafeFS checkpoint found for ${resolved.relativePath}.`
    );
  }

  const checkpoint = options.checkpointId
    ? events.find((event) => event.eventId === options.checkpointId)
    : events[events.length - 1];

  if (!checkpoint) {
    throw new SafeFSError(
      "CHECKPOINT_NOT_FOUND",
      `Checkpoint not found for ${resolved.relativePath}: ${options.checkpointId}`
    );
  }

  if (checkpoint.operation === "move") {
    return restoreMovedFile({ ...options, path: resolved.relativePath, checkpoint });
  }

  const latestEvent = events[events.length - 1]!;
  const conflict = await detectRestoreConflict({
    absolutePath: resolved.absolutePath,
    path: resolved.relativePath,
    eventId: latestEvent.eventId,
    expectedHash: latestEvent.afterHash ?? null,
  });
  const rollbackOf = events
    .filter((event) => new Date(event.timestamp).getTime() >= new Date(checkpoint.timestamp).getTime())
    .map((event) => event.eventId);
  const action: RestoreFileActionType = checkpoint.beforeObject ? "restore" : "delete_created_file";
  const effectiveDryRun = !(options.dryRun === false && options.confirm === true);

  const result: RestoreFileResult = {
    success: true,
    dryRun: effectiveDryRun,
    path: resolved.relativePath,
    checkpointId: checkpoint.eventId,
    action,
    targetHash: checkpoint.beforeHash ?? null,
    expectedHash: latestEvent.afterHash ?? null,
    currentHash: conflict?.currentHash ?? await currentHashOrNull(resolved.absolutePath),
    applied: false,
    deleted: false,
    rollbackOf,
    conflicts: conflict ? [conflict] : [],
  };

  if (effectiveDryRun || conflict) {
    return result;
  }

  await createRollbackSuppression({
    root,
    paths: [resolved.relativePath],
  });

  if (checkpoint.beforeObject) {
    const content = await loadObject(root, checkpoint.beforeObject);
    await atomicWriteFile(resolved.absolutePath, content);
    result.applied = true;
  } else if (await fileExists(resolved.absolutePath)) {
    await fs.unlink(resolved.absolutePath);
    result.deleted = true;
  }

  result.rollbackEventId = await appendRestoreEvent({
    root,
    path: resolved.relativePath,
    rollbackOf,
  });
  result.currentHash = await currentHashOrNull(resolved.absolutePath);
  return result;
}

async function restoreMovedFile(options: {
  root: string;
  path: string;
  checkpoint: TimelineEvent;
  dryRun?: boolean;
  confirm?: boolean;
  config: SafeFSConfig;
}): Promise<RestoreFileResult> {
  const move = options.checkpoint.move;
  if (!move || !options.checkpoint.afterObject) {
    throw new SafeFSError("INVALID_MOVE_CHECKPOINT", "Move checkpoint is missing restore metadata.");
  }

  const to = await resolveSafePath({
    root: options.root,
    requestedPath: move.toPath,
    config: options.config,
  });
  const from = await resolveSafePath({
    root: options.root,
    requestedPath: move.fromPath,
    config: options.config,
  });
  const sourceConflict = await detectRestoreConflict({
    absolutePath: to.absolutePath,
    path: to.relativePath,
    eventId: options.checkpoint.eventId,
    expectedHash: options.checkpoint.afterHash ?? null,
  });
  const destinationConflict = await detectRestoreConflict({
    absolutePath: from.absolutePath,
    path: from.relativePath,
    eventId: options.checkpoint.eventId,
    expectedHash: null,
  });
  const conflicts = [sourceConflict, destinationConflict].filter((item): item is ConflictDetail => Boolean(item));
  const effectiveDryRun = !(options.dryRun === false && options.confirm === true);
  const result: RestoreFileResult = {
    success: true,
    dryRun: effectiveDryRun,
    path: to.relativePath,
    checkpointId: options.checkpoint.eventId,
    action: "move_back",
    targetHash: options.checkpoint.beforeHash ?? options.checkpoint.afterHash ?? null,
    expectedHash: options.checkpoint.afterHash ?? null,
    currentHash: await currentHashOrNull(to.absolutePath),
    applied: false,
    deleted: false,
    rollbackOf: [options.checkpoint.eventId],
    conflicts,
  };

  if (effectiveDryRun || conflicts.length > 0) {
    return result;
  }

  await createRollbackSuppression({
    root: options.root,
    paths: [from.relativePath, to.relativePath],
  });

  const content = await loadObject(options.root, options.checkpoint.afterObject);
  if (await fileExists(to.absolutePath)) {
    await fs.unlink(to.absolutePath);
  }
  await atomicWriteFile(from.absolutePath, content);
  result.applied = true;
  result.rollbackEventId = await appendRestoreEvent({
    root: options.root,
    path: to.relativePath,
    rollbackOf: result.rollbackOf,
  });
  result.currentHash = await currentHashOrNull(to.absolutePath);
  return result;
}

async function getCommittedMutationsForPath(root: string, filePath: string): Promise<TimelineEvent[]> {
  const events = await queryEvents(root, {});
  return events
    .filter((event) => isCommittedMutation(event) && matchesPath(event, filePath))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

function isCommittedMutation(event: TimelineEvent): boolean {
  const committedByStatus = event.status === undefined ? event.committed : event.status === "committed";
  return (
    committedByStatus &&
    event.committed &&
    (event.operation === "write" ||
      event.operation === "patch" ||
      event.operation === "delete" ||
      event.operation === "move")
  );
}

function matchesPath(event: TimelineEvent, filePath: string): boolean {
  return event.path === filePath || event.move?.fromPath === filePath || event.move?.toPath === filePath;
}

async function detectRestoreConflict(options: {
  absolutePath: string;
  path: string;
  eventId: string;
  expectedHash: string | null;
}): Promise<ConflictDetail | null> {
  const exists = await fileExists(options.absolutePath);
  if (!exists) {
    if (options.expectedHash === null) return null;
    return {
      path: options.path,
      eventId: options.eventId,
      expectedHash: options.expectedHash,
      currentHash: null,
      reason: "File no longer matches the selected restore checkpoint.",
      suggestedAction: "Run safe_restore_file with dryRun first, then inspect the file before applying.",
    };
  }

  const currentHash = await sha256File(options.absolutePath);
  if (currentHash === options.expectedHash) {
    return null;
  }

  return {
    path: options.path,
    eventId: options.eventId,
    expectedHash: options.expectedHash,
    currentHash,
    reason: "File was modified after the selected SafeFS checkpoint.",
    suggestedAction: "Review current file content or choose a newer checkpoint before applying restore.",
  };
}

async function currentHashOrNull(absolutePath: string): Promise<string | null> {
  return (await fileExists(absolutePath)) ? sha256File(absolutePath) : null;
}

async function appendRestoreEvent(options: {
  root: string;
  path: string;
  rollbackOf: string[];
}): Promise<string> {
  const rollbackEventId = generateEventId();
  await appendEvent(options.root, {
    eventId: rollbackEventId,
    timestamp: new Date().toISOString(),
    actor: "user",
    tool: "safe_restore_file",
    operation: "rollback",
    path: options.path,
    risk: "medium",
    committed: true,
    status: "committed",
    rollbackOf: options.rollbackOf,
  });
  return rollbackEventId;
}
