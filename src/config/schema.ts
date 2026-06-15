import { z } from "zod";
import { MANDATORY_PROTECTED_PATTERNS } from "./defaultConfig.js";

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
    })
    .default({}),
});

export type SafeFSConfigInput = z.input<typeof SafeFSConfigSchema>;
