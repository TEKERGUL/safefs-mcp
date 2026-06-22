import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./loadConfig.js";
import type { SafeFSConfig } from "../types/index.js";

let cachedConfig: SafeFSConfig | null = null;
let cachedMtimeMs: number | null = null;
let cachedRoot: string | null = null;

export async function loadConfigCached(root: string): Promise<SafeFSConfig> {
  const configPath = path.join(root, ".safefs.yml");

  try {
    const stat = await fs.stat(configPath);
    if (cachedRoot === root && cachedMtimeMs === stat.mtimeMs && cachedConfig) {
      return cachedConfig;
    }
    cachedConfig = await loadConfig(root);
    cachedMtimeMs = stat.mtimeMs;
    cachedRoot = root;
    return cachedConfig;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      if (cachedRoot === root && cachedMtimeMs === -1 && cachedConfig) {
        return cachedConfig;
      }
      cachedConfig = await loadConfig(root);
      cachedMtimeMs = -1;
      cachedRoot = root;
      return cachedConfig;
    }
    return loadConfig(root);
  }
}
