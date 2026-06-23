import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export async function atomicWriteFile(
  targetPath: string,
  content: Buffer | string,
  options?: { mode?: number; verify?: boolean }
): Promise<void> {
  const dir = path.dirname(targetPath);
  await fs.mkdir(dir, { recursive: true });

  const tmpFile = path.join(dir, `.safefs_tmp_${randomUUID().slice(0, 8)}`);
  const expected = Buffer.isBuffer(content) ? content : Buffer.from(content);

  try {
    await fs.writeFile(tmpFile, content, { mode: options?.mode });
    await robustRename(tmpFile, targetPath);
    if (options?.verify) {
      await verifyWrite(targetPath, expected);
    }
  } catch (err) {
    try {
      await fs.unlink(tmpFile);
    } catch {
      // cleanup best-effort
    }
    throw err;
  }
}

async function robustRename(source: string, target: string): Promise<void> {
  if (process.platform !== "win32") {
    return fs.rename(source, target);
  }

  const MAX_RETRIES = 3;
  const DELAYS = [10, 50, 100];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await fs.rename(source, target);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if ((code === "EPERM" || code === "EACCES") && attempt < MAX_RETRIES) {
        const delay = DELAYS[attempt] ?? DELAYS.at(-1) ?? 100;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

async function verifyWrite(targetPath: string, expected: Buffer): Promise<void> {
  const actual = await fs.readFile(targetPath);
  if (!actual.equals(expected)) {
    throw new Error(`Atomic write verification failed for ${targetPath}`);
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
