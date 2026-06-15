import { getFullStorageStatus } from "../core/storageStats.js";
import type { SafeFSConfig } from "../types/index.js";
import type { FullStorageStatus } from "../core/storageStats.js";

export async function safeStorageStatus(
  root: string,
  config: SafeFSConfig
): Promise<FullStorageStatus> {
  return getFullStorageStatus(root, config);
}
