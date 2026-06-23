import fs from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile } from "./workspace.js";
import type { SafeFSConfig } from "../types/index.js";

const SUPPRESSION_PATH = ".safefs/state/suppressions.json";
const DEFAULT_ROLLBACK_TTL_MS = 5_000;
const DEFAULT_LEGACY_WRITE_TTL_MS = 3_000;
const SUPPRESSION_BUFFER_MS = 1_000;
const MIN_LEGACY_SUPPRESSION_TTL_MS = 2_500;
const MIN_ROLLBACK_SUPPRESSION_TTL_MS = 5_000;
const ROLLBACK_PATH_BUDGET_MS = 50;

export type SuppressionReason = "rollback" | "safe_write" | "safe_patch" | "safe_delete";

interface SuppressionFile {
  expiresAt: string;
  paths: string[];
  reason: SuppressionReason;
}

export async function createSuppression(options: {
  root: string;
  paths: string[];
  reason: SuppressionReason;
  ttlMs?: number;
}): Promise<void> {
  const payload: SuppressionFile = {
    expiresAt: new Date(Date.now() + (options.ttlMs ?? DEFAULT_LEGACY_WRITE_TTL_MS)).toISOString(),
    paths: [...new Set(options.paths)].sort(),
    reason: options.reason,
  };

  await atomicWriteFile(
    path.join(options.root, SUPPRESSION_PATH),
    `${JSON.stringify(payload, null, 2)}\n`,
    { mode: 0o600 }
  );
}

export async function createRollbackSuppression(options: {
  root: string;
  paths: string[];
  ttlMs?: number;
}): Promise<void> {
  await createSuppression({
    root: options.root,
    paths: options.paths,
    reason: "rollback",
    ttlMs: options.ttlMs ?? DEFAULT_ROLLBACK_TTL_MS,
  });
}

export function calculateLegacySuppressionTtlMs(config: SafeFSConfig): number {
  return Math.max(
    MIN_LEGACY_SUPPRESSION_TTL_MS,
    config.watch.intervalMs + config.watch.debounceMs + SUPPRESSION_BUFFER_MS
  );
}

export function calculateRollbackSuppressionTtlMs(
  config: SafeFSConfig,
  pathCount: number
): number {
  return Math.max(
    MIN_ROLLBACK_SUPPRESSION_TTL_MS,
    config.watch.intervalMs +
      config.watch.debounceMs +
      SUPPRESSION_BUFFER_MS +
      pathCount * ROLLBACK_PATH_BUDGET_MS
  );
}

export async function isPathSuppressed(root: string, relativePath: string): Promise<boolean> {
  const suppression = await readSuppression(root);
  return isPathSuppressedBy(suppression, relativePath);
}

export async function loadSuppressionState(root: string): Promise<SuppressionFile | null> {
  return readSuppression(root);
}

export function isPathSuppressedBy(suppression: SuppressionFile | null, relativePath: string): boolean {
  if (!suppression) return false;
  return suppression.paths.includes("*") || suppression.paths.includes(relativePath);
}

async function readSuppression(root: string): Promise<SuppressionFile | null> {
  const filePath = path.join(root, SUPPRESSION_PATH);

  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as SuppressionFile;
    if (new Date(parsed.expiresAt).getTime() <= Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
