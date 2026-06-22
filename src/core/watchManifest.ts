import path from "node:path";
import fs from "node:fs/promises";
import { atomicWriteFile } from "./workspace.js";
import type { FileSnapshot } from "./externalChangeRecorder.js";

const MANIFEST_PATH = ".safefs/watch/manifest.json";

interface WatchManifestFile {
  version: 1;
  updatedAt: string;
  files: Record<string, FileSnapshot>;
}

export async function loadWatchManifest(root: string): Promise<Map<string, FileSnapshot>> {
  const filePath = path.join(root, MANIFEST_PATH);

  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<WatchManifestFile>;
    const files = parsed.files ?? {};
    return new Map(Object.entries(files));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return new Map();
    }
    return new Map();
  }
}

export async function saveWatchManifest(
  root: string,
  snapshot: Map<string, FileSnapshot>
): Promise<void> {
  const manifest: WatchManifestFile = {
    version: 1,
    updatedAt: new Date().toISOString(),
    files: Object.fromEntries([...snapshot.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };

  await atomicWriteFile(
    path.join(root, MANIFEST_PATH),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { mode: 0o600 }
  );
}
