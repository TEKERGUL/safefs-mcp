import fs from "node:fs/promises";
import { loadObject } from "./objectStore.js";
import { planRollbackSince } from "./rollback.js";
import { fileExists } from "./workspace.js";
import type { DiffResult, FileDiff, SafeFSConfig } from "../types/index.js";

export async function diffSince(options: {
  root: string;
  since: string;
  path?: string;
  config: SafeFSConfig;
}): Promise<DiffResult> {
  const plan = await planRollbackSince(options);
  const diffs: FileDiff[] = [];

  for (const item of plan.planned) {
    if (item.item.action === "move_back" && item.item.moveFromPath && item.item.moveToPath) {
      diffs.push({
        path: item.item.path,
        action: item.item.action,
        eventIds: item.item.eventIds,
        diff: `MOVE ${item.item.moveFromPath} -> ${item.item.moveToPath}\nRollback: move ${item.item.moveToPath} -> ${item.item.moveFromPath}\n`,
        binary: false,
      });
      continue;
    }

    const current = (await fileExists(item.absolutePath))
      ? await fs.readFile(item.absolutePath)
      : null;
    const target = item.earliestEvent.beforeObject
      ? await loadObject(options.root, item.earliestEvent.beforeObject)
      : null;

    diffs.push({
      path: item.item.path,
      action: item.item.action,
      eventIds: item.item.eventIds,
      diff: createUnifiedDiff(item.item.path, current, target),
      binary: isBinary(current) || isBinary(target),
    });
  }
  return {
    success: true,
    since: options.since,
    diffs,
    skipped: plan.skipped,
    conflicts: plan.conflicts,
    summary: {
      filesChanged: diffs.length,
      conflicts: plan.conflicts.length,
      skipped: plan.skipped.length,
    },
  };
}

function createUnifiedDiff(
  filePath: string,
  current: Buffer | null,
  target: Buffer | null
): string {
  const oldLabel = current ? `a/${filePath}` : "/dev/null";
  const newLabel = target ? `b/${filePath}` : "/dev/null";

  if (isBinary(current) || isBinary(target)) {
    return `--- ${oldLabel}\n+++ ${newLabel}\nBinary files differ\n`;
  }

  const oldData = splitLines(current?.toString("utf-8") ?? "");
  const newData = splitLines(target?.toString("utf-8") ?? "");

  const oldLines = oldData.lines;
  const newLines = newData.lines;

  if (oldLines.join("\n") === newLines.join("\n") && oldData.noTrailing === newData.noTrailing) {
    return `--- ${oldLabel}\n+++ ${newLabel}\n`;
  }

  const oldCount = oldLines.length;
  const newCount = newLines.length;
  const lines = [
    `--- ${oldLabel}`,
    `+++ ${newLabel}`,
    `@@ -${oldCount === 0 ? 0 : 1},${oldCount} +${newCount === 0 ? 0 : 1},${newCount} @@`,
    ...diffLines(oldData, newData),
  ];

  return `${lines.join("\n")}\n`;
}

function splitLines(text: string): { lines: string[]; noTrailing: boolean } {
  if (text.length === 0) return { lines: [], noTrailing: false };
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const noTrailing = lines[lines.length - 1] !== "";
  if (!noTrailing) {
    lines.pop();
  }
  return { lines, noTrailing };
}

function diffLines(
  oldData: { lines: string[]; noTrailing: boolean },
  newData: { lines: string[]; noTrailing: boolean }
): string[] {
  const oldLines = oldData.lines;
  const newLines = newData.lines;

  if (oldLines.length * newLines.length > 1_000_000) {
    const res = [
      ...oldLines.map((line) => `-${line}`),
      ...newLines.map((line) => `+${line}`),
    ];
    if (oldData.noTrailing) res.splice(oldLines.length, 0, "\\ No newline at end of file");
    if (newData.noTrailing) res.push("\\ No newline at end of file");
    return res;
  }

  const rows = oldLines.length + 1;
  const cols = newLines.length + 1;
  const table = Array.from({ length: rows }, () => Array<number>(cols).fill(0));
  const getCell = (row: number, col: number): number => table[row]?.[col] ?? 0;

  for (let i = oldLines.length - 1; i >= 0; i--) {
    const row = table[i];
    if (!row) {
      throw new Error(`Diff table row ${i} was not initialized.`);
    }

    for (let j = newLines.length - 1; j >= 0; j--) {
      row[j] =
        oldLines[i] === newLines[j]
          ? getCell(i + 1, j + 1) + 1
          : Math.max(getCell(i + 1, j), getCell(i, j + 1));
    }
  }

  const result: string[] = [];
  let i = 0;
  let j = 0;

  while (i < oldLines.length && j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      result.push(` ${oldLines[i]}`);
      i++;
      j++;
    } else if (getCell(i + 1, j) >= getCell(i, j + 1)) {
      result.push(`-${oldLines[i]}`);
      i++;
    } else {
      result.push(`+${newLines[j]}`);
      j++;
    }
  }

  while (i < oldLines.length) {
    result.push(`-${oldLines[i]}`);
    i++;
  }

  while (j < newLines.length) {
    result.push(`+${newLines[j]}`);
    j++;
  }

  let lastOldLineIdx = -1;
  for (let k = result.length - 1; k >= 0; k--) {
    const l = result[k] as string;
    if (l.startsWith("-") || l.startsWith(" ")) {
      lastOldLineIdx = k;
      break;
    }
  }
  if (oldData.noTrailing && lastOldLineIdx !== -1 && (result[lastOldLineIdx] as string).startsWith("-")) {
    result.splice(lastOldLineIdx + 1, 0, "\\ No newline at end of file");
  }

  let lastNewLineIdx = -1;
  for (let k = result.length - 1; k >= 0; k--) {
    const l = result[k] as string;
    if (l.startsWith("+") || l.startsWith(" ")) {
      lastNewLineIdx = k;
      break;
    }
  }
  if (newData.noTrailing && lastNewLineIdx !== -1 && (result[lastNewLineIdx] as string).startsWith("+")) {
    result.splice(lastNewLineIdx + 1, 0, "\\ No newline at end of file");
  }

  return result;
}

function isBinary(buffer: Buffer | null): boolean {
  return buffer?.includes(0) ?? false;
}
