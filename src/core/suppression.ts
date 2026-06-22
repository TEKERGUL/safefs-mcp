import fs from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile } from "./workspace.js";

const SUPPRESSION_PATH = ".safefs/state/suppressions.json";
const DEFAULT_TTL_MS = 60_000;

interface SuppressionFile {
  expiresAt: string;
  paths: string[];
  reason: string;
}

export async function createRollbackSuppression(options: {
  root: string;
  paths: string[];
  ttlMs?: number;
}): Promise<void> {
  const payload: SuppressionFile = {
    expiresAt: new Date(Date.now() + (options.ttlMs ?? DEFAULT_TTL_MS)).toISOString(),
    paths: [...new Set(options.paths)].sort(),
    reason: "rollback",
  };

  await atomicWriteFile(
    path.join(options.root, SUPPRESSION_PATH),
    `${JSON.stringify(payload, null, 2)}\n`,
    { mode: 0o600 }
  );
}

export async function isPathSuppressed(root: string, relativePath: string): Promise<boolean> {
  const suppression = await readSuppression(root);
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
