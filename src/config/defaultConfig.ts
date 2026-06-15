import type { SafeFSConfig } from "../types/index.js";

export const MANDATORY_PROTECTED_PATTERNS = [
  ".git",
  ".git/**",
  "**/.git",
  "**/.git/**",
  ".safefs",
  ".safefs/**",
  "**/.safefs",
  "**/.safefs/**",
  ".env",
  ".env.*",
  "**/.env",
  "**/.env.*",
  "*.pem",
  "**/*.pem",
  "*.key",
  "**/*.key",
  "id_rsa",
  "id_ed25519",
  "**/id_rsa",
  "**/id_ed25519",
  "secrets",
  "secrets/**",
  "**/secrets",
  "**/secrets/**",
  "node_modules",
  "node_modules/**",
  "**/node_modules",
  "**/node_modules/**",
  "dist",
  "dist/**",
  "build",
  "build/**",
  ".next",
  ".next/**",
  "coverage",
  "coverage/**",
];

export const DEFAULT_CONFIG: SafeFSConfig = {
  workspace: {
    root: ".",
    followSymlinks: false,
  },
  limits: {
    maxFileSizeMB: 50,
    maxTimelineEventsWarning: 10000,
    maxPatchSearchLength: 20000,
  },
  protected: [...MANDATORY_PROTECTED_PATTERNS],
  rollback: {
    defaultDryRun: true,
    conflictMode: "skip",
  },
  storage: {
    objectCompression: false,
    retentionWarningDays: 30,
  },
};

export const DEFAULT_CONFIG_YAML = `workspace:
  root: "."
  followSymlinks: false

limits:
  maxFileSizeMB: 50
  maxTimelineEventsWarning: 10000
  maxPatchSearchLength: 20000

# Add project-specific protected patterns here. SafeFS also enforces
# mandatory protected paths such as .git/, .safefs/, .env*, keys,
# secrets/, node_modules/, dist/, and build/ even if this list is empty.
protected:
  - ".git/**"
  - ".safefs/**"
  - ".env"
  - ".env.*"
  - "**/*.pem"
  - "**/*.key"
  - "**/id_rsa"
  - "**/id_ed25519"
  - "secrets/**"
  - "node_modules/**"
  - "dist/**"
  - "build/**"
  - ".next/**"
  - "coverage/**"

rollback:
  defaultDryRun: true
  conflictMode: "skip"

storage:
  objectCompression: false
  retentionWarningDays: 30
`;
