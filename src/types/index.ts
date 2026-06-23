export type Operation = "write" | "patch" | "delete" | "move" | "rollback";

export type RiskLevel = "low" | "medium" | "high" | "blocked";

export type TimelineStatus = "pending" | "committed" | "failed";

export type RollbackActionType = "restore" | "delete_created" | "move_back";
export type RestoreFileActionType = "restore" | "delete_created_file" | "move_back";

export interface PatchMetadata {
  search?: string;
  replace?: string;
  beforeBlockObject?: string;
  afterBlockObject?: string;
  leadingContext?: string;
  trailingContext?: string;
  lineStart?: number;
  lineEnd?: number;
}

export interface TimelineEvent {
  eventId: string;
  sessionId?: string;
  timestamp: string;
  actor: "agent" | "user" | "system";
  tool: string;
  operation: Operation;
  path: string;
  beforeHash?: string | null;
  afterHash?: string | null;
  beforeObject?: string | null;
  afterObject?: string | null;
  patch?: PatchMetadata;
  move?: {
    fromPath: string;
    toPath: string;
  };
  risk: RiskLevel;
  reason?: string;
  committed: boolean;
  status?: TimelineStatus;
  rollbackOf?: string[];
  error?: string;
}

export interface TimelineFilter {
  since?: Date;
  until?: Date;
  path?: string;
  sessionId?: string;
  limit?: number;
  operation?: Operation;
}

export interface RollbackPlanItem {
  path: string;
  action: RollbackActionType;
  eventIds: string[];
  beforeHash: string | null;
  afterHash: string | null;
  moveFromPath?: string;
  moveToPath?: string;
}

export interface SafeFSConfig {
  workspace: {
    root: string;
    followSymlinks: boolean;
  };
  limits: {
    maxFileSizeMB: number;
    maxTimelineEventsWarning: number;
    maxPatchSearchLength: number;
  };
  protected: string[];
  rollback: {
    defaultDryRun: boolean;
    conflictMode: "skip" | "overwrite";
  };
  storage: {
    objectCompression: boolean;
    retentionWarningDays: number;
    retentionDays: number;
    autoprune: boolean;
    maxTimelineBytesMB: number;
    maxObjectStoreBytesMB: number;
  };
  watch: {
    intervalMs: number;
    debounceMs: number;
    moveDetectionWindowMs: number;
    maxEventsPerCycle: number;
    maxPendingChangesWarning: number;
    maxFileSizeMB: number;
    maxSnapshotBytesMB: number;
    respectGitignore: boolean;
    exclude: string[];
  };
}

export interface StorageStats {
  objectCount: number;
  totalObjectSizeBytes: number;
  approximateSize: string;
}

export interface ConflictDetail {
  path: string;
  eventId: string;
  expectedHash: string | null;
  currentHash: string | null;
  reason: string;
  suggestedAction: string;
}

export interface RollbackResult {
  success: boolean;
  dryRun: boolean;
  planned: string[];
  plannedActions?: RollbackPlanItem[];
  reverted: string[];
  skipped: string[];
  conflicts: ConflictDetail[];
  rollbackEventId?: string;
}

export interface FileDiff {
  path: string;
  action: RollbackActionType;
  eventIds: string[];
  diff: string;
  binary: boolean;
}

export interface DiffResult {
  success: true;
  since: string;
  diffs: FileDiff[];
  skipped: string[];
  conflicts: ConflictDetail[];
  summary: {
    filesChanged: number;
    conflicts: number;
    skipped: number;
  };
}

export interface RestoreFileResult {
  success: true;
  dryRun: boolean;
  path: string;
  checkpointId: string;
  action: RestoreFileActionType;
  targetHash: string | null;
  expectedHash: string | null;
  currentHash: string | null;
  applied: boolean;
  deleted: boolean;
  rollbackEventId?: string;
  rollbackOf: string[];
  conflicts: ConflictDetail[];
}

export class SafeFSError extends Error {
  code: string;
  details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "SafeFSError";
    this.code = code;
    this.details = details;
  }
}
