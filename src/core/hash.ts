import { createHash } from "node:crypto";
import fs from "node:fs/promises";

export function sha256Buffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function sha256File(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return sha256Buffer(content);
}
