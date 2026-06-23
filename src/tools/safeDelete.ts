import fs from "node:fs/promises";
import { resolveSafePath } from "../core/pathSafety.js";
import { saveObject } from "../core/objectStore.js";
import { sha256Buffer } from "../core/hash.js";
import { appendEvent, generateEventId } from "../core/timeline.js";
import { fileExists, isDirectory } from "../core/workspace.js";
import { fileMutexes } from "../core/mutex.js";
import { calculateLegacySuppressionTtlMs, createSuppression } from "../core/suppression.js";
import type { SafeFSConfig, RiskLevel } from "../types/index.js";
import { SafeFSError } from "../types/index.js";

export interface DeleteResult {
  success: true;
  eventId: string;
  path: string;
  operation: "delete";
  beforeHash: string;
  afterHash: null;
  risk: RiskLevel;
}

export async function safeDelete(options: {
  root: string;
  path: string;
  reason?: string;
  sessionId?: string;
  config: SafeFSConfig;
}): Promise<DeleteResult> {
  const { root, reason, sessionId, config } = options;

  const resolved = await resolveSafePath({
    root,
    requestedPath: options.path,
    config,
  });

  if (await isDirectory(resolved.absolutePath)) {
    throw new SafeFSError(
      "DIRECTORY_DELETE_UNSUPPORTED",
      "Directory delete is not supported. Delete files individually."
    );
  }

  const release = await fileMutexes.acquire(resolved.absolutePath);
  try {
    if (!(await fileExists(resolved.absolutePath))) {
      throw new SafeFSError(
        "FILE_NOT_FOUND",
        `File not found: ${resolved.relativePath}`
      );
    }

    const stat = await fs.stat(resolved.absolutePath);
    const maxBytes = config.limits.maxFileSizeMB * 1024 * 1024;
    if (stat.size > maxBytes) {
      throw new SafeFSError(
        "FILE_TOO_LARGE",
        `File exceeds maximum size of ${config.limits.maxFileSizeMB}MB: ${resolved.relativePath}`
      );
    }

    const existingContent = await fs.readFile(resolved.absolutePath);
    const beforeHash = sha256Buffer(existingContent);
    const beforeObject = await saveObject(root, existingContent, {
      compression: config.storage.objectCompression,
    });
    const eventId = generateEventId();
    const pendingEvent = {
      eventId,
      sessionId,
      timestamp: new Date().toISOString(),
      actor: "agent" as const,
      tool: "safe_delete",
      operation: "delete" as const,
      path: resolved.relativePath,
      beforeHash,
      afterHash: null,
      beforeObject,
      afterObject: null,
      risk: "high" as const,
      reason,
      committed: false,
      status: "pending" as const,
    };

    await appendEvent(root, pendingEvent);
    await createSuppression({
      root,
      paths: [resolved.relativePath],
      reason: "safe_delete",
      ttlMs: calculateLegacySuppressionTtlMs(config),
    });

    try {
      await fs.unlink(resolved.absolutePath);
    } catch (err) {
      await appendEvent(root, {
        ...pendingEvent,
        timestamp: new Date().toISOString(),
        status: "failed",
        error: err instanceof Error ? err.message : "Unknown delete error",
      });
      throw err;
    }

    await appendEvent(root, {
      ...pendingEvent,
      timestamp: new Date().toISOString(),
      committed: true,
      status: "committed",
    });

    return {
      success: true,
      eventId,
      path: resolved.relativePath,
      operation: "delete",
      beforeHash,
      afterHash: null,
      risk: "high",
    };
  } finally {
    release();
  }
}
