import fs from "node:fs/promises";
import path from "node:path";

export interface FsCapabilities {
  caseSensitive: boolean;
  checkedAt: string;
}

const CAPABILITIES_PATH = ".safefs/watch/fs-capabilities.json";

export async function detectFsCapabilities(
  root: string,
  options: { writeCache?: boolean } = {}
): Promise<FsCapabilities> {
  const normalizedRoot = path.resolve(root);
  const cachePath = path.join(normalizedRoot, CAPABILITIES_PATH);

  try {
    const parsed: unknown = JSON.parse(await fs.readFile(cachePath, "utf-8"));
    if (isCapabilities(parsed)) return parsed;
  } catch {
    // Missing or unreadable cache falls through to detection.
  }

  const capabilities: FsCapabilities = {
    caseSensitive: await probeCaseSensitivity(normalizedRoot, options.writeCache ?? true),
    checkedAt: new Date().toISOString(),
  };

  if (options.writeCache ?? true) {
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, `${JSON.stringify(capabilities, null, 2)}\n`, "utf-8");
  }

  return capabilities;
}

async function probeCaseSensitivity(root: string, writeProbe: boolean): Promise<boolean> {
  if (process.platform === "win32") return false;
  if (!writeProbe) return process.platform !== "darwin";

  const probeDir = path.join(root, ".safefs", "watch");
  await fs.mkdir(probeDir, { recursive: true });
  const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const lower = path.join(probeDir, `.case-probe-${suffix}`);
  const upper = path.join(probeDir, `.CASE-PROBE-${suffix}`);

  try {
    await fs.writeFile(lower, "lower", { flag: "wx" });
    try {
      await fs.writeFile(upper, "upper", { flag: "wx" });
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw err;
    }
  } finally {
    await fs.rm(lower, { force: true });
    await fs.rm(upper, { force: true });
  }
}

function isCapabilities(value: unknown): value is FsCapabilities {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as FsCapabilities).caseSensitive === "boolean" &&
    typeof (value as FsCapabilities).checkedAt === "string"
  );
}
