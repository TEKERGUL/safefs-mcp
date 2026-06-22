import { safeRollbackTime } from "../tools/safeRollbackTime.js";
import { loadConfig } from "../config/loadConfig.js";

export async function runRollback(
  root: string,
  since: string,
  options: { dryRun?: boolean; path?: string; yes?: boolean }
): Promise<void> {
  const config = await loadConfig(root);
  const effectiveDryRun = !options.yes;
  const confirm = options.yes === true;

  const result = await safeRollbackTime({
    root,
    since,
    path: options.path,
    dryRun: effectiveDryRun,
    confirm,
    config,
  });

  if (result.dryRun) {
    console.log(`SafeFS rollback since ${since} - dry run`);
    console.log("");

    for (const item of result.plannedActions ?? []) {
      const action =
        item.action === "delete_created"
          ? "would delete agent-created file"
          : item.action === "move_back"
            ? `would move ${item.moveToPath} back to ${item.moveFromPath}`
            : "would restore previous content";
      console.log(`RESTORE ${item.path.padEnd(35)} ${action}`);
    }

    printConflicts(result.conflicts);
    printSkipped(result.skipped, result.conflicts.map((conflict) => conflict.path));

    console.log("");
    const restorable = result.plannedActions?.length ?? result.planned.length;
    const conflictCount = result.conflicts.length;
    const parts: string[] = [];
    if (restorable > 0) parts.push(`${restorable} file${restorable > 1 ? "s" : ""} can be restored`);
    if (conflictCount > 0) parts.push(`${conflictCount} conflict${conflictCount > 1 ? "s" : ""}`);

    if (parts.length > 0) {
      console.log(parts.join(" | "));
    } else {
      console.log("No files to rollback.");
    }

    if (restorable > 0) {
      console.log("");
      const pathFlag = options.path ? ` --path ${options.path}` : "";
      console.log("Apply with:");
      console.log(`safefs rollback ${since}${pathFlag} --yes`);
    }
    return;
  }

  console.log(`SafeFS rollback since ${since} - applied`);
  console.log("");

  for (const filePath of result.reverted) {
    console.log(`RESTORED ${filePath}`);
  }
  printConflicts(result.conflicts);
  printSkipped(result.skipped, result.conflicts.map((conflict) => conflict.path));

  console.log("");
  console.log(
    `${result.reverted.length} file${result.reverted.length !== 1 ? "s" : ""} restored` +
      (result.rollbackEventId ? ` | event: ${result.rollbackEventId}` : "")
  );
}

function printConflicts(
  conflicts: Array<{
    path: string;
    expectedHash: string | null;
    currentHash: string | null;
    reason: string;
    suggestedAction: string;
  }>
): void {
  for (const conflict of conflicts) {
    console.log(`CONFLICT ${conflict.path.padEnd(33)} ${conflict.reason}`);
    console.log(`         expected: ${conflict.expectedHash ?? "missing"}`);
    console.log(`         current:  ${conflict.currentHash ?? "missing"}`);
    console.log(`         action:   ${conflict.suggestedAction}`);
  }
}

function printSkipped(skipped: string[], conflictPaths: string[]): void {
  for (const filePath of skipped) {
    if (!conflictPaths.includes(filePath)) {
      console.log(`SKIPPED  ${filePath}`);
    }
  }
}
