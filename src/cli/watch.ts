import { loadConfig } from "../config/loadConfig.js";
import { detectWorkspaceChanges, scanWorkspaceForWatch } from "../core/watch.js";
import { generateSessionId } from "../core/workspace.js";
import type { WatchSnapshot } from "../core/watch.js";

export interface WatchOptions {
  intervalMs?: number;
  once?: boolean;
}

export async function runWatch(
  root: string,
  options: WatchOptions = {}
): Promise<void> {
  const intervalMs = options.intervalMs ?? 1000;
  const config = await loadConfig(root);
  const sessionId = generateSessionId();
  let current: WatchSnapshot = (await scanWorkspaceForWatch({ root, config })).snapshot;

  console.log("SafeFS watch started.");
  console.log(`Root: ${root}`);
  console.log(`Tracked files: ${current.size}`);
  console.log(`Interval: ${intervalMs}ms`);
  console.log("Press Ctrl+C to stop.");

  if (options.once) {
    return;
  }

  await new Promise<void>((resolve) => {
    let running = false;
    const timer = setInterval(() => {
      if (running) return;
      running = true;
      void runWatchCycle({
        root,
        config,
        sessionId,
        current,
        onSnapshot: (next) => {
          current = next;
        },
      }).finally(() => {
        running = false;
      });
    }, intervalMs);

    process.once("SIGINT", () => {
      clearInterval(timer);
      console.log("");
      console.log("SafeFS watch stopped.");
      resolve();
    });
  });
}

async function runWatchCycle(options: {
  root: string;
  config: Awaited<ReturnType<typeof loadConfig>>;
  sessionId: string;
  current: WatchSnapshot;
  onSnapshot: (snapshot: WatchSnapshot) => void;
}): Promise<void> {
  try {
    const result = await detectWorkspaceChanges({
      root: options.root,
      config: options.config,
      previous: options.current,
      sessionId: options.sessionId,
    });
    options.onSnapshot(result.snapshot);

    for (const event of result.events) {
      console.log(
        `  ${event.operation?.padEnd(6)} ${event.path} (${event.eventId})`
      );
    }
  } catch (err) {
    console.error(`SafeFS watch warning: ${(err as Error).message}`);
  }
}
