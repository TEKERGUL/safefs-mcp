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
  "*.p12",
  "**/*.p12",
  "*.pfx",
  "**/*.pfx",
  "*.crt",
  "**/*.crt",
  "*.cer",
  "**/*.cer",
  "*.token",
  "**/*.token",
  "id_rsa",
  "id_ed25519",
  "**/id_rsa",
  "**/id_ed25519",
  ".npmrc",
  "**/.npmrc",
  ".pypirc",
  "**/.pypirc",
  ".ssh",
  ".ssh/**",
  "**/.ssh",
  "**/.ssh/**",
  ".aws",
  ".aws/**",
  "**/.aws",
  "**/.aws/**",
  "credentials*",
  "**/credentials*",
  "service-account*.json",
  "**/service-account*.json",
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

export const DEFAULT_WATCH_EXCLUDE_PATTERNS = [
  "node_modules/**",
  "dist/**",
  "build/**",
  ".next/**",
  "coverage/**",
  ".cache/**",
  ".turbo/**",
  ".pnpm-store/**",
  "*.log",
  "*.tmp",
  "*.temp",
  "*.swp",
  "*.swo",
  "~$*",
  ".safefs_tmp_*",
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
  watch: {
    intervalMs: 1000,
    debounceMs: 750,
    maxFileSizeMB: 5,
    maxSnapshotBytesMB: 250,
    respectGitignore: true,
    exclude: [...DEFAULT_WATCH_EXCLUDE_PATTERNS],
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
# package tokens, cloud credentials, secrets/, node_modules/, dist/,
# and build/ even if this list is empty.
protected:
  - ".git/**"
  - ".safefs/**"
  - ".env"
  - ".env.*"
  - "**/*.pem"
  - "**/*.key"
  - "**/*.p12"
  - "**/*.pfx"
  - "**/*.crt"
  - "**/*.cer"
  - "**/*.token"
  - ".npmrc"
  - ".pypirc"
  - ".ssh/**"
  - ".aws/**"
  - "credentials*"
  - "service-account*.json"
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

watch:
  intervalMs: 1000
  debounceMs: 750
  maxFileSizeMB: 5
  maxSnapshotBytesMB: 250
  respectGitignore: true
  exclude:
    - "node_modules/**"
    - "dist/**"
    - "build/**"
    - ".next/**"
    - "coverage/**"
    - ".cache/**"
    - "*.log"
    - "*.tmp"
    - "*.temp"
    - ".safefs_tmp_*"
`;
