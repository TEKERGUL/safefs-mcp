import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import picomatch from "picomatch";
import { MANDATORY_PROTECTED_PATTERNS } from "../config/defaultConfig.js";
import { SafeFSError } from "../types/index.js";
import type { SafeFSConfig } from "../types/index.js";

export interface ResolvedPath {
  absolutePath: string;
  relativePath: string;
}

export async function resolveSafePath(options: {
  root: string;
  requestedPath: string;
  allowSafefsInternal?: boolean;
  config: SafeFSConfig;
}): Promise<ResolvedPath> {
  const { root, requestedPath, allowSafefsInternal = false, config } = options;

  if (requestedPath.includes("\0")) {
    throw new SafeFSError(
      "PATH_OUTSIDE_ROOT",
      "Path contains null bytes."
    );
  }

  const base = path.basename(requestedPath);
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i.test(base)) {
    throw new SafeFSError(
      "INVALID_PATH",
      "Windows reserved filenames are not allowed."
    );
  }

  const normalizedRoot = path.resolve(root);
  const resolved = path.resolve(normalizedRoot, requestedPath);
  const relativePath = path.relative(normalizedRoot, resolved);

  if (
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    throw new SafeFSError(
      "PATH_OUTSIDE_ROOT",
      `Path resolves outside workspace root: ${requestedPath}`
    );
  }

  const posixRelative = relativePath.split(path.sep).join("/");

  if (!allowSafefsInternal) {
    if (
      posixRelative === ".safefs" ||
      posixRelative.startsWith(".safefs/")
    ) {
      throw new SafeFSError(
        "SAFEFS_INTERNAL_ACCESS",
        "Direct access to .safefs/ internals is not allowed."
      );
    }
  }

  const isProtected = checkProtectedPatterns(
    posixRelative,
    getEffectiveProtectedPatterns(config.protected)
  );

  const isSafefsFolder = posixRelative === ".safefs" || posixRelative.startsWith(".safefs/");
  if (isProtected && !(allowSafefsInternal && isSafefsFolder)) {
    throw new SafeFSError(
      "PROTECTED_PATH",
      `Path is protected: ${posixRelative}`
    );
  }

  if (!config.workspace.followSymlinks) {
    await checkSymlinkEscape(resolved, normalizedRoot);
  }

  return {
    absolutePath: resolved,
    relativePath: posixRelative,
  };
}

export function getEffectiveProtectedPatterns(
  configuredPatterns: string[]
): string[] {
  return [...new Set([...MANDATORY_PROTECTED_PATTERNS, ...configuredPatterns])];
}

function checkProtectedPatterns(
  relativePath: string,
  patterns: string[]
): boolean {
  for (const pattern of patterns) {
    const matcher = picomatch(pattern, { dot: true });
    if (matcher(relativePath)) {
      return true;
    }
  }
  return false;
}

export async function openSafePath(options: {
  root: string;
  requestedPath: string;
  config: SafeFSConfig;
  flags: number;
  mode?: number;
}): Promise<{ fd: fs.FileHandle; resolved: ResolvedPath }> {
  const resolved = await resolveSafePath({
    root: options.root,
    requestedPath: options.requestedPath,
    config: options.config,
  });

  let openFlags = options.flags;
  if (process.platform !== "win32" && !options.config.workspace.followSymlinks) {
    openFlags |= constants.O_NOFOLLOW;
  }

  const fd = await fs.open(resolved.absolutePath, openFlags, options.mode);
  return { fd, resolved };
}

async function checkSymlinkEscape(
  resolvedPath: string,
  root: string
): Promise<void> {
  try {
    const realPath = await fs.realpath(resolvedPath);
    const realRoot = await fs.realpath(root);

    if (!realPath.startsWith(realRoot + path.sep) && realPath !== realRoot) {
      throw new SafeFSError(
        "PATH_OUTSIDE_ROOT",
        "Symlink resolves outside workspace root."
      );
    }
  } catch (err) {
    if (err instanceof SafeFSError) throw err;
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      let dir = path.dirname(resolvedPath);
      while (dir !== root && dir !== path.dirname(dir)) {
        try {
          const realDir = await fs.realpath(dir);
          const realRoot = await fs.realpath(root);
          if (!realDir.startsWith(realRoot + path.sep) && realDir !== realRoot) {
            throw new SafeFSError(
              "PATH_OUTSIDE_ROOT",
              "Symlink in path resolves outside workspace root."
            );
          }
          break;
        } catch (innerErr) {
          if (innerErr instanceof SafeFSError) throw innerErr;
          if ((innerErr as NodeJS.ErrnoException).code === "ENOENT") {
            dir = path.dirname(dir);
            continue;
          }
          break;
        }
      }
    }
  }
}
