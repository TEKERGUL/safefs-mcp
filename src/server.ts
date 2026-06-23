import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadConfigCached } from "./config/cachedConfig.js";
import { safeReadFile } from "./tools/safeReadFile.js";
import { safeWrite } from "./tools/safeWrite.js";
import { safePatch } from "./tools/safePatch.js";
import { safeDelete } from "./tools/safeDelete.js";
import { safeDiff } from "./tools/safeDiff.js";
import { safeTimeline } from "./tools/safeTimeline.js";
import { safeRollbackTime } from "./tools/safeRollbackTime.js";
import { safeStorageStatus } from "./tools/safeStorageStatus.js";
import { SafeFSError } from "./types/index.js";

export function createServer(root: string): McpServer {
  const server = new McpServer({
    name: "safefs",
    version: "1.2.0",
  });

  server.tool(
    "safe_read_file",
    "Read a file inside the workspace safely. Validates path against workspace root and protected patterns.",
    {
      path: z.string().min(1).describe("Relative path to the file within the workspace"),
    },
    async ({ path: filePath }) => {
      try {
        const config = await loadConfigCached(root);
        const result = await safeReadFile(root, filePath, config);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return formatError(err);
      }
    }
  );

  server.tool(
    "safe_write",
    "Deprecated compatibility writer. Prefer safefs guard/watch for normal native edits; use this only when a client explicitly needs SafeFS-managed writes.",
    {
      path: z.string().min(1).describe("Relative path to the file within the workspace"),
      content: z.string().describe("Full content to write to the file"),
      reason: z.string().optional().describe("Human-readable reason for the change"),
      sessionId: z.string().optional().describe("Session identifier for grouping changes"),
    },
    async ({ path: filePath, content, reason, sessionId }) => {
      try {
        const config = await loadConfigCached(root);
        const result = await safeWrite({ root, path: filePath, content, reason, sessionId, config });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return formatError(err);
      }
    }
  );

  server.tool(
    "safe_patch",
    "Deprecated compatibility patcher. Prefer safefs guard/watch for normal native edits; this still records before and after state hashes for rollback.",
    {
      path: z.string().min(1).describe("Relative path to the file within the workspace"),
      search: z.string().describe("Exact text to find in the file"),
      replace: z.string().describe("Text to replace the search string with"),
      replaceAll: z.boolean().optional().describe("Replace all occurrences (default: false)"),
      reason: z.string().optional().describe("Human-readable reason for the change"),
      sessionId: z.string().optional().describe("Session identifier for grouping changes"),
    },
    async ({ path: filePath, search, replace, replaceAll, reason, sessionId }) => {
      try {
        const config = await loadConfigCached(root);
        const result = await safePatch({ root, path: filePath, search, replace, replaceAll, reason, sessionId, config });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return formatError(err);
      }
    }
  );

  server.tool(
    "safe_delete",
    "Deprecated compatibility deleter. Prefer safefs guard/watch for normal native deletes; this stores file content for restoration via rollback.",
    {
      path: z.string().min(1).describe("Relative path to the file within the workspace"),
      reason: z.string().optional().describe("Human-readable reason for deletion"),
      sessionId: z.string().optional().describe("Session identifier for grouping changes"),
    },
    async ({ path: filePath, reason, sessionId }) => {
      try {
        const config = await loadConfigCached(root);
        const result = await safeDelete({ root, path: filePath, reason, sessionId, config });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return formatError(err);
      }
    }
  );

  server.tool(
    "safe_diff",
    "Preview rollback changes as unified diffs. Uses the same conflict checks as safe_rollback_time.",
    {
      since: z.string().describe("Diff changes since this time (e.g., 15m, 1h, 3h, 1d, 7d, or ISO timestamp)"),
      path: z.string().min(1).optional().describe("Only diff this specific file path"),
    },
    async ({ since, path: filePath }) => {
      try {
        const config = await loadConfigCached(root);
        const result = await safeDiff({ root, since, path: filePath, config });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return formatError(err);
      }
    }
  );

  server.tool(
    "safe_timeline",
    "Show file-change history. Lists events with timestamps, operations, paths, and risk levels.",
    {
      since: z.string().optional().describe("Start time (e.g., 15m, 1h, 3h, 1d, 7d, or ISO timestamp)"),
      until: z.string().optional().describe("End time (same format as since)"),
      path: z.string().min(1).optional().describe("Filter by file path"),
      sessionId: z.string().optional().describe("Filter by session ID"),
      limit: z.number().int().positive().optional().describe("Maximum number of events to return"),
    },
    async ({ since, until, path: filePath, sessionId, limit }) => {
      try {
        const config = await loadConfigCached(root);
        const result = await safeTimeline({ root, since, until, path: filePath, sessionId, limit, config });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return formatError(err);
      }
    }
  );

  server.tool(
    "safe_rollback_time",
    "Roll back AI file changes since a time. Defaults to dry-run. Use confirm: true and dryRun: false to apply.",
    {
      since: z.string().describe("Rollback changes since this time (e.g., 15m, 1h, 3h, 1d, 7d, or ISO timestamp)"),
      path: z.string().min(1).optional().describe("Only rollback this specific file path"),
      dryRun: z.boolean().optional().describe("Preview rollback without applying (default: true)"),
      confirm: z.boolean().optional().describe("Confirm rollback application (required with dryRun: false)"),
    },
    async ({ since, path: filePath, dryRun, confirm }) => {
      try {
        const config = await loadConfigCached(root);
        const result = await safeRollbackTime({ root, since, path: filePath, dryRun, confirm, config });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return formatError(err);
      }
    }
  );

  server.tool(
    "safe_storage_status",
    "Show SafeFS storage information including event count, object count, and size.",
    {},
    async () => {
      try {
        const config = await loadConfigCached(root);
        const result = await safeStorageStatus(root, config);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return formatError(err);
      }
    }
  );

  return server;
}

function formatError(err: unknown): { content: Array<{ type: "text"; text: string }>; isError?: boolean } {
  if (err instanceof SafeFSError) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: err.code,
            message: err.message,
            details: err.details,
          }, null, 2),
        },
      ],
      isError: true,
    };
  }

  const message = err instanceof Error ? err.message : "Unknown error";
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          success: false,
          error: "INTERNAL_ERROR",
          message,
        }, null, 2),
      },
    ],
    isError: true,
  };
}
