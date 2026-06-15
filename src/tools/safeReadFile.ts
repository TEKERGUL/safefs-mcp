import fs from "node:fs/promises";
import { resolveSafePath } from "../core/pathSafety.js";
import type { SafeFSConfig } from "../types/index.js";
import { SafeFSError } from "../types/index.js";

export interface ReadFileResult {
  success: true;
  path: string;
  content: string;
  sizeBytes: number;
}

export async function safeReadFile(
  root: string,
  filePath: string,
  config: SafeFSConfig
): Promise<ReadFileResult> {
  const resolved = await resolveSafePath({
    root,
    requestedPath: filePath,
    config,
  });

  const stat = await fs.stat(resolved.absolutePath).catch((err) => {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new SafeFSError(
        "FILE_NOT_FOUND",
        `File not found: ${resolved.relativePath}`
      );
    }
    throw err;
  });

  if (stat.isDirectory()) {
    throw new SafeFSError(
      "FILE_NOT_FOUND",
      `Path is a directory, not a file: ${resolved.relativePath}`
    );
  }

  const maxBytes = config.limits.maxFileSizeMB * 1024 * 1024;
  if (stat.size > maxBytes) {
    throw new SafeFSError(
      "FILE_TOO_LARGE",
      `File exceeds maximum size of ${config.limits.maxFileSizeMB}MB: ${resolved.relativePath}`
    );
  }

  const content = await fs.readFile(resolved.absolutePath, "utf-8");

  return {
    success: true,
    path: resolved.relativePath,
    content,
    sizeBytes: stat.size,
  };
}
