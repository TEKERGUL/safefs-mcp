import fs from "node:fs/promises";
import { resolveSafePath } from "../core/pathSafety.js";
import { saveObject } from "../core/objectStore.js";
import { sha256Buffer } from "../core/hash.js";
import { appendEvent, generateEventId } from "../core/timeline.js";
import { atomicWriteFile, fileExists } from "../core/workspace.js";
import { fileMutexes } from "../core/mutex.js";
import { appendAuditLog } from "../core/auditLog.js";
import { calculateLegacySuppressionTtlMs, createSuppression } from "../core/suppression.js";
import type { SafeFSConfig, RiskLevel } from "../types/index.js";
import { SafeFSError } from "../types/index.js";

export interface WriteResult {
  success: true;
  eventId: string;
  path: string;
  operation: "write";
  beforeHash: string | null;
  afterHash: string;
  risk: RiskLevel;
}

export async function safeWrite(options: {
  root: string;
  path: string;
  content: string;
  reason?: string;
  sessionId?: string;
  config: SafeFSConfig;
}): Promise<WriteResult> {
  const { root, content, reason, sessionId, config } = options;

  const resolved = await resolveSafePath({
    root,
    requestedPath: options.path,
    config,
  });

  const contentBuffer = Buffer.from(content);
  const maxBytes = config.limits.maxFileSizeMB * 1024 * 1024;
  if (contentBuffer.length > maxBytes) {
    throw new SafeFSError(
      "FILE_TOO_LARGE",
      `Content exceeds maximum size of ${config.limits.maxFileSizeMB}MB.`
    );
  }

  let beforeHash: string | null = null;
  let beforeObject: string | null = null;
  let risk: RiskLevel = "low";

  const release = await fileMutexes.acquire(resolved.absolutePath);
  try {
    if (await fileExists(resolved.absolutePath)) {
      const existingContent = await fs.readFile(resolved.absolutePath);
      beforeHash = sha256Buffer(existingContent);
      beforeObject = await saveObject(root, existingContent, {
        compression: config.storage.objectCompression,
      });
      risk = "medium";
    }

    const afterHash = sha256Buffer(contentBuffer);
    const afterObject = await saveObject(root, contentBuffer, {
      compression: config.storage.objectCompression,
    });
    const eventId = generateEventId();
    const pendingEvent = {
      eventId,
      sessionId,
      timestamp: new Date().toISOString(),
      actor: "agent" as const,
      tool: "safe_write",
      operation: "write" as const,
      path: resolved.relativePath,
      beforeHash,
      afterHash,
      beforeObject,
      afterObject,
      risk,
      reason,
      committed: false,
      status: "pending" as const,
    };

    await appendEvent(root, pendingEvent);
    await createSuppression({
      root,
      paths: [resolved.relativePath],
      reason: "safe_write",
      ttlMs: calculateLegacySuppressionTtlMs(config),
    });

    try {
      await atomicWriteFile(resolved.absolutePath, contentBuffer);
    } catch (err) {
      if (beforeObject) {
        try {
          const { loadObject } = await import("../core/objectStore.js");
          const original = await loadObject(root, beforeObject);
          await atomicWriteFile(resolved.absolutePath, original);
        } catch {
          await appendAuditLog(root, "error", "Failed to restore file after write error", {
            path: resolved.relativePath,
            beforeObject,
          });
        }
      }
      await appendEvent(root, {
        ...pendingEvent,
        timestamp: new Date().toISOString(),
        status: "failed",
        error: err instanceof Error ? err.message : "Unknown write error",
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
      operation: "write",
      beforeHash,
      afterHash,
      risk,
    };
  } finally {
    release();
  }
}
