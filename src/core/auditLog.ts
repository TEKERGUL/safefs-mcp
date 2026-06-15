import fs from "node:fs/promises";
import path from "node:path";
import { auditMutex } from "./mutex.js";

export async function appendAuditLog(
  root: string,
  level: "info" | "warn" | "error",
  message: string,
  details?: unknown
): Promise<void> {
  const logPath = path.join(root, ".safefs", "audit.log");
  const timestamp = new Date().toISOString();
  const entry = details
    ? `[${timestamp}] [${level.toUpperCase()}] ${message} ${JSON.stringify(details)}\n`
    : `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;

  const release = await auditMutex.acquire();
  try {
    try {
      const stat = await fs.stat(logPath);
      if (stat.size > 5 * 1024 * 1024) {
        await fs.rename(logPath, path.join(root, ".safefs", "audit.1.log"));
      }
    } catch {
      // file might not exist yet
    }

    await fs.appendFile(logPath, entry, "utf-8");
  } catch {
    // audit log write failure is non-fatal
  } finally {
    release();
  }
}
