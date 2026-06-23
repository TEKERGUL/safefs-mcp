import fs from "node:fs/promises";
import { resolveSafePath } from "../core/pathSafety.js";
import { saveObject } from "../core/objectStore.js";
import { sha256Buffer } from "../core/hash.js";
import { appendEvent, generateEventId } from "../core/timeline.js";
import { atomicWriteFile, fileExists } from "../core/workspace.js";
import { applyPatch } from "../core/patch.js";
import { fileMutexes } from "../core/mutex.js";
import { appendAuditLog } from "../core/auditLog.js";
import { calculateLegacySuppressionTtlMs, createSuppression } from "../core/suppression.js";
import type { SafeFSConfig, RiskLevel } from "../types/index.js";
import { SafeFSError } from "../types/index.js";

export interface PatchResult {
  success: true;
  eventId: string;
  path: string;
  operation: "patch";
  lineStart?: number;
  lineEnd?: number;
  beforeHash: string;
  afterHash: string;
  risk: RiskLevel;
}

export async function safePatch(options: {
  root: string;
  path: string;
  search: string;
  replace: string;
  replaceAll?: boolean;
  reason?: string;
  sessionId?: string;
  config: SafeFSConfig;
}): Promise<PatchResult> {
  const { root, search, replace, replaceAll, reason, sessionId, config } = options;

  const resolved = await resolveSafePath({
    root,
    requestedPath: options.path,
    config,
  });

  const release = await fileMutexes.acquire(resolved.absolutePath);
  try {
    if (!(await fileExists(resolved.absolutePath))) {
      throw new SafeFSError(
        "FILE_NOT_FOUND",
        `File not found: ${resolved.relativePath}`
      );
    }

    const existingContent = await fs.readFile(resolved.absolutePath, "utf-8");
    const existingBuffer = Buffer.from(existingContent);

    const maxBytes = config.limits.maxFileSizeMB * 1024 * 1024;
    if (existingBuffer.length > maxBytes) {
      throw new SafeFSError(
        "FILE_TOO_LARGE",
        `File exceeds maximum size of ${config.limits.maxFileSizeMB}MB: ${resolved.relativePath}`
      );
    }

    const patchResult = applyPatch({
      content: existingContent,
      search,
      replace,
      replaceAll,
      maxSearchLength: config.limits.maxPatchSearchLength,
    });

    const beforeHash = sha256Buffer(existingBuffer);
    const beforeObject = await saveObject(root, existingBuffer, {
      compression: config.storage.objectCompression,
    });

    const patchedBuffer = Buffer.from(patchResult.patched);
    const afterHash = sha256Buffer(patchedBuffer);
    const afterObject = await saveObject(root, patchedBuffer, {
      compression: config.storage.objectCompression,
    });

    const beforeBlockObject = await saveObject(root, search, {
      compression: config.storage.objectCompression,
    });
    const afterBlockObject = await saveObject(root, replace, {
      compression: config.storage.objectCompression,
    });
    const eventId = generateEventId();
    const pendingEvent = {
      eventId,
      sessionId,
      timestamp: new Date().toISOString(),
      actor: "agent" as const,
      tool: "safe_patch",
      operation: "patch" as const,
      path: resolved.relativePath,
      beforeHash,
      afterHash,
      beforeObject,
      afterObject,
      patch: {
        search,
        replace,
        beforeBlockObject,
        afterBlockObject,
        leadingContext: patchResult.leadingContext,
        trailingContext: patchResult.trailingContext,
        lineStart: patchResult.lineStart,
        lineEnd: patchResult.lineEnd,
      },
      risk: "medium" as const,
      reason,
      committed: false,
      status: "pending" as const,
    };

    await appendEvent(root, pendingEvent);
    await createSuppression({
      root,
      paths: [resolved.relativePath],
      reason: "safe_patch",
      ttlMs: calculateLegacySuppressionTtlMs(config),
    });

    try {
      await atomicWriteFile(resolved.absolutePath, patchedBuffer);
    } catch (err) {
      try {
        const { loadObject } = await import("../core/objectStore.js");
        const original = await loadObject(root, beforeObject);
        await atomicWriteFile(resolved.absolutePath, original);
      } catch {
        await appendAuditLog(root, "error", "Failed to restore file after patch error", {
          path: resolved.relativePath,
          beforeObject,
        });
      }
      await appendEvent(root, {
        ...pendingEvent,
        timestamp: new Date().toISOString(),
        status: "failed",
        error: err instanceof Error ? err.message : "Unknown patch error",
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
      operation: "patch",
      lineStart: patchResult.lineStart,
      lineEnd: patchResult.lineEnd,
      beforeHash,
      afterHash,
      risk: "medium",
    };
  } finally {
    release();
  }
}
