import { rollbackSince } from "../core/rollback.js";
import type { SafeFSConfig, RollbackResult } from "../types/index.js";

export async function safeRollbackTime(options: {
  root: string;
  since: string;
  path?: string;
  dryRun?: boolean;
  confirm?: boolean;
  config: SafeFSConfig;
}): Promise<RollbackResult> {
  return rollbackSince({
    root: options.root,
    since: options.since,
    path: options.path,
    dryRun: options.dryRun,
    confirm: options.confirm,
    config: options.config,
  });
}
