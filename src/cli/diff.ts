import { safeDiff } from "../tools/safeDiff.js";
import { loadConfig } from "../config/loadConfig.js";

export async function runDiff(
  root: string,
  options: { since: string; path?: string }
): Promise<void> {
  const config = await loadConfig(root);
  const result = await safeDiff({
    root,
    since: options.since,
    path: options.path,
    config,
  });

  if (result.diffs.length === 0 && result.conflicts.length === 0) {
    console.log(`SafeFS diff since ${options.since}: no rollback changes found.`);
    return;
  }

  console.log(`SafeFS diff since ${options.since}`);
  console.log("");

  for (const file of result.diffs) {
    console.log(`# ${file.path} (${file.action})`);
    process.stdout.write(file.diff);
    if (!file.diff.endsWith("\n")) {
      console.log("");
    }
    console.log("");
  }

  for (const conflict of result.conflicts) {
    console.log(`# ${conflict.path} (conflict)`);
    console.log(`expected: ${conflict.expectedHash ?? "missing"}`);
    console.log(`current:  ${conflict.currentHash ?? "missing"}`);
    console.log(`reason:   ${conflict.reason}`);
    console.log(`action:   ${conflict.suggestedAction}`);
    console.log("");
  }

  console.log(
    `${result.summary.filesChanged} file${result.summary.filesChanged === 1 ? "" : "s"} with diffs` +
      (result.summary.conflicts > 0
        ? `, ${result.summary.conflicts} conflict${result.summary.conflicts === 1 ? "" : "s"}`
        : "")
  );
}
