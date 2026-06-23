import { z } from "zod";
import { MANDATORY_PROTECTED_PATTERNS, DEFAULT_WATCH_EXCLUDE_PATTERNS } from "./defaultConfig.js";

export const SafeFSConfigSchema = z.object({
  workspace: z
    .object({
      root: z.string().default("."),
      followSymlinks: z.boolean().default(false),
    })
    .default({}),
  limits: z
    .object({
      maxFileSizeMB: z.number().positive().max(1024).default(50),
      maxTimelineEventsWarning: z.number().positive().max(1000000).default(10000),
      maxPatchSearchLength: z.number().positive().max(1000000).default(20000),
    })
    .default({}),
  protected: z
    .array(z.string())
    .default([...MANDATORY_PROTECTED_PATTERNS]),
  rollback: z
    .object({
      defaultDryRun: z.boolean().default(true),
      conflictMode: z.enum(["skip", "overwrite"]).default("skip"),
    })
    .default({}),
  storage: z
    .object({
      objectCompression: z.boolean().default(false),
      retentionWarningDays: z.number().positive().max(3650).default(30),
      retentionDays: z.number().positive().max(3650).default(30),
      autoprune: z.boolean().default(false),
    })
    .default({}),
  watch: z
    .object({
      intervalMs: z.number().int().positive().max(60000).default(1000),
      debounceMs: z.number().int().nonnegative().max(60000).default(750),
      moveDetectionWindowMs: z.number().int().nonnegative().max(60000).default(5000),
      maxFileSizeMB: z.number().positive().max(1024).default(5),
      maxSnapshotBytesMB: z.number().positive().max(1024 * 1024).default(250),
      respectGitignore: z.boolean().default(true),
      exclude: z.array(z.string()).default([...DEFAULT_WATCH_EXCLUDE_PATTERNS]),
    })
    .default({}),
});

export type SafeFSConfigInput = z.input<typeof SafeFSConfigSchema>;