import { safeTimeline } from "../tools/safeTimeline.js";
import { loadConfig } from "../config/loadConfig.js";

export async function runTimeline(
  root: string,
  options: { since?: string; path?: string; limit?: number }
): Promise<void> {
  const config = await loadConfig(root);
  const result = await safeTimeline({
    root,
    since: options.since,
    path: options.path,
    limit: options.limit,
    config,
  });

  if (result.events.length === 0) {
    const timeDesc = options.since ? ` since ${options.since}` : "";
    console.log(`SafeFS timeline${timeDesc}: no events found.`);
    return;
  }

  const timeDesc = options.since ? ` since ${options.since}` : "";
  console.log(`SafeFS timeline${timeDesc}`);
  console.log("");

  for (const event of result.events) {
    const time = new Date(event.timestamp).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const op = event.operation.padEnd(7);
    const filePath = event.path.padEnd(35);
    const risk = event.risk.padEnd(7);
    const reason = event.reason ?? "";
    console.log(`${time}  ${op} ${filePath} ${risk} ${reason}`);
  }

  console.log("");
  console.log(
    `${result.summary.totalEvents} events · ${result.summary.changedFiles.length} files · rollback available`
  );
}
