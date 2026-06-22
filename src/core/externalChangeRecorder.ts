import fs from "node:fs/promises";
import { saveObject } from "./objectStore.js";
import { sha256Buffer } from "./hash.js";
import { appendEvent, generateEventId, queryRecentEvents } from "./timeline.js";
import { resolveSafePath } from "./pathSafety.js";
import { fileExists, isDirectory } from "./workspace.js";
import { fileMutexes } from "./mutex.js";
import type { Operation, RiskLevel, SafeFSConfig, TimelineEvent } from "../types/index.js";
import { SafeFSError } from "../types/index.js";

export interface FileSnapshot {
  hash: string;
  object: string;
  size: number;
  mtimeMs: number;
  binary?: boolean;
}

export interface ExternalChangeResult {
  recorded: boolean;
  eventId?: string;
  path: string;
  operation?: Operation;
  reason?: string;
}

export async function snapshotFileForExternalTracking(options: {
  root: string;
  path: string;
  config: SafeFSConfig;
  maxFileSizeMB?: number;
  skipBinary?: boolean;
  dryRun?: boolean;
}): Promise<FileSnapshot | null> {
  const { root, config } = options;
  const resolved = await resolveSafePath({
    root,
    requestedPath: options.path,
    config,
  });

  if (!(await fileExists(resolved.absolutePath))) {
    return null;
  }

  if (await isDirectory(resolved.absolutePath)) {
    return null;
  }

  const stat = await fs.stat(resolved.absolutePath);
  const maxBytes = (options.maxFileSizeMB ?? config.limits.maxFileSizeMB) * 1024 * 1024;
  if (stat.size > maxBytes) {
    throw new SafeFSError(
      "FILE_TOO_LARGE",
      `File exceeds maximum size of ${options.maxFileSizeMB ?? config.limits.maxFileSizeMB}MB: ${resolved.relativePath}`
    );
  }

  const content = await fs.readFile(resolved.absolutePath);
  const binary = isProbablyBinary(content);
  if (options.skipBinary && binary) {
    throw new SafeFSError("BINARY_FILE_SKIPPED", `Binary file skipped: ${resolved.relativePath}`);
  }

  const hash = sha256Buffer(content);
  return {
    hash,
    object: options.dryRun ? hash : await saveObject(root, content),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    binary,
  };
}

export async function recordExternalChange(options: {
  root: string;
  path: string;
  before: FileSnapshot | null;
  after: FileSnapshot | null;
  tool: string;
  reason?: string;
  sessionId?: string;
  config: SafeFSConfig;
  dedupeWindowMs?: number;
}): Promise<ExternalChangeResult> {
  const { root, before, after, tool, reason, sessionId, config } = options;
  const resolved = await resolveSafePath({
    root,
    requestedPath: options.path,
    config,
  });

  if (!before && !after) {
    return {
      recorded: false,
      path: resolved.relativePath,
      reason: "No file state exists before or after the change.",
    };
  }

  if (before?.hash === after?.hash) {
    return {
      recorded: false,
      path: resolved.relativePath,
      reason: "File content hash did not change.",
    };
  }

  const release = await fileMutexes.acquire(resolved.relativePath);
  try {
    const operation = getExternalOperation(before, after);
    if (await hasDuplicateRecentEvent({ ...options, path: resolved.relativePath, operation })) {
      return {
        recorded: false,
        path: resolved.relativePath,
        operation,
        reason: "Recent equivalent timeline event already exists.",
      };
    }

    const risk = getExternalRisk(operation, before);
    const eventId = generateEventId();
    const baseEvent: TimelineEvent = {
      eventId,
      sessionId,
      timestamp: new Date().toISOString(),
      actor: "agent",
      tool,
      operation,
      path: resolved.relativePath,
      beforeHash: before?.hash ?? null,
      afterHash: after?.hash ?? null,
      beforeObject: before?.object ?? null,
      afterObject: after?.object ?? null,
      risk,
      reason,
      committed: false,
      status: "pending",
    };

    await appendCommittedPair(root, baseEvent);

    return {
      recorded: true,
      eventId,
      path: resolved.relativePath,
      operation,
    };
  } finally {
    release();
  }
}

export async function recordExternalMove(options: {
  root: string;
  fromPath: string;
  toPath: string;
  snapshot: FileSnapshot;
  tool: string;
  reason?: string;
  sessionId?: string;
  config: SafeFSConfig;
  dedupeWindowMs?: number;
}): Promise<ExternalChangeResult> {
  const from = await resolveSafePath({ root: options.root, requestedPath: options.fromPath, config: options.config });
  const to = await resolveSafePath({ root: options.root, requestedPath: options.toPath, config: options.config });

  const release = await fileMutexes.acquire(to.relativePath);
  try {
    if (
      await hasDuplicateRecentEvent({
        root: options.root,
        path: to.relativePath,
        before: options.snapshot,
        after: options.snapshot,
        operation: "move",
        config: options.config,
        dedupeWindowMs: options.dedupeWindowMs,
      })
    ) {
      return {
        recorded: false,
        path: to.relativePath,
        operation: "move",
        reason: "Recent equivalent timeline event already exists.",
      };
    }

    const eventId = generateEventId();
    const baseEvent: TimelineEvent = {
      eventId,
      sessionId: options.sessionId,
      timestamp: new Date().toISOString(),
      actor: "agent",
      tool: options.tool,
      operation: "move",
      path: to.relativePath,
      beforeHash: options.snapshot.hash,
      afterHash: options.snapshot.hash,
      beforeObject: options.snapshot.object,
      afterObject: options.snapshot.object,
      move: {
        fromPath: from.relativePath,
        toPath: to.relativePath,
      },
      risk: "medium",
      reason: options.reason,
      committed: false,
      status: "pending",
    };

    await appendCommittedPair(options.root, baseEvent);

    return {
      recorded: true,
      eventId,
      path: to.relativePath,
      operation: "move",
    };
  } finally {
    release();
  }
}

async function appendCommittedPair(root: string, baseEvent: TimelineEvent): Promise<void> {
  await appendEvent(root, baseEvent);
  await appendEvent(root, {
    ...baseEvent,
    timestamp: new Date().toISOString(),
    committed: true,
    status: "committed",
  });
}

async function hasDuplicateRecentEvent(options: {
  root: string;
  path: string;
  before: FileSnapshot | null;
  after: FileSnapshot | null;
  operation: Operation;
  config: SafeFSConfig;
  dedupeWindowMs?: number;
}): Promise<boolean> {
  const since = new Date(Date.now() - (options.dedupeWindowMs ?? 5000));
  const events = await queryRecentEvents(options.root, { since, path: options.path });

  return events.some((event) => {
    if (!event.committed) return false;
    if (event.operation !== options.operation) return false;
    return (
      (event.beforeHash ?? null) === (options.before?.hash ?? null) &&
      (event.afterHash ?? null) === (options.after?.hash ?? null)
    );
  });
}

function getExternalOperation(
  before: FileSnapshot | null,
  after: FileSnapshot | null
): Operation {
  if (before && !after) return "delete";
  return "write";
}

function getExternalRisk(
  operation: Operation,
  before: FileSnapshot | null
): RiskLevel {
  if (operation === "delete") return "high";
  return before ? "medium" : "low";
}

function isProbablyBinary(buffer: Buffer): boolean {
  if (buffer.includes(0)) return true;
  const sample = buffer.subarray(0, Math.min(buffer.length, 8000));
  if (sample.length === 0) return false;

  let suspicious = 0;
  for (const byte of sample) {
    if (byte < 7 || (byte > 14 && byte < 32)) {
      suspicious++;
    }
  }
  return suspicious / sample.length > 0.1;
}