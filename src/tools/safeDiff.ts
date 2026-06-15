import { diffSince } from "../core/diff.js";
import type { DiffResult, SafeFSConfig } from "../types/index.js";

export async function safeDiff(options: {
  root: string;
  since: string;
  path?: string;
  config: SafeFSConfig;
}): Promise<DiffResult> {
  return diffSince({
    root: options.root,
    since: options.since,
    path: options.path,
    config: options.config,
  });
}
