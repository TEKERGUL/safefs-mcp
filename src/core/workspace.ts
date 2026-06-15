import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export async function atomicWriteFile(
  targetPath: string,
  content: Buffer | string,
  options?: { mode?: number }
): Promise<void> {
  const dir = path.dirname(targetPath);
  await fs.mkdir(dir, { recursive: true });

  const tmpFile = path.join(dir, `.safefs_tmp_${randomUUID().slice(0, 8)}`);

  try {
    await fs.writeFile(tmpFile, content, options);
    await fs.rename(tmpFile, targetPath);
  } catch (err) {
    try {
      await fs.unlink(tmpFile);
    } catch {
      // cleanup best-effort
    }
    throw err;
  }
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

export async function isDirectory(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export function generateSessionId(): string {
  return `ses_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}
