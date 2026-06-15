import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { SafeFSConfigSchema } from "./schema.js";
import { DEFAULT_CONFIG } from "./defaultConfig.js";
import type { SafeFSConfig } from "../types/index.js";
import { SafeFSError } from "../types/index.js";

export async function loadConfig(root: string): Promise<SafeFSConfig> {
  const configPath = path.join(root, ".safefs.yml");

  try {
    const content = await fs.readFile(configPath, "utf-8");
    let raw: unknown;
    try {
      raw = yaml.load(content, { schema: yaml.JSON_SCHEMA });
    } catch (parseErr) {
      throw new SafeFSError(
        "INVALID_CONFIG",
        `Failed to parse .safefs.yml: ${(parseErr as Error).message}`
      );
    }

    if (raw === null || raw === undefined) {
      return DEFAULT_CONFIG;
    }

    const result = SafeFSConfigSchema.safeParse(raw);

    if (!result.success) {
      throw new SafeFSError(
        "INVALID_CONFIG",
        `Invalid .safefs.yml: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`,
        result.error.issues
      );
    }

    return result.data;
  } catch (err) {
    if (err instanceof SafeFSError) throw err;

    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return DEFAULT_CONFIG;
    }

    throw new SafeFSError(
      "CONFIG_READ_ERROR",
      `Failed to read .safefs.yml: ${(err as Error).message}`
    );
  }
}
