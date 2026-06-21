import fs from "node:fs/promises";
import { saveObject } from "./objectStore.js";
import { sha256Buffer } from "./hash.js";
import { appendEvent, generateEventId } from "./timeline.js";
import { resolveSafePath } from "./pathSafety.js";
import { fileExists, isDirectory } from "./workspace.js";
import type { Operation, RiskLevel, SafeFSConfig, TimelineEvent } from "../types/index.js";
import { SafeFSError } from "../types/index.js";

export interface FileSnapshot {
  hash: string;
  object: string;
  size: number;
  mtimeMs: number;
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
  const maxBytes = config.limits.maxFileSizeMB * 1024 * 1024;
  if (stat.size > maxBytes) {
    throw new SafeFSError(
      "FILE_TOO_LARGE",
      `File exceeds maximum size of ${config.limits.maxFileSizeMB}MB: ${resolved.relativePath}`
    );
  }

  const content = await fs.readFile(resolved.absolutePath);
  return {
    hash: sha256Buffer(content),
    object: await saveObject(root, content),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
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

  const operation = getExternalOperation(before, after);
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

  await appendEvent(root, baseEvent);
  await appendEvent(root, {
    ...baseEvent,
    timestamp: new Date().toISOString(),
    committed: true,
    status: "committed",
  });

  return {
    recorded: true,
    eventId,
    path: resolved.relativePath,
    operation,
  };
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


