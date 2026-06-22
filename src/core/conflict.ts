import type { ConflictDetail, TimelineEvent } from "../types/index.js";
import { sha256File } from "./hash.js";
import { fileExists } from "./workspace.js";

export async function detectConflict(
  filePath: string,
  latestEvent: TimelineEvent
): Promise<ConflictDetail | null> {
  const exists = await fileExists(filePath);
  const expectedHash = latestEvent.afterHash ?? null;

  if (latestEvent.operation === "delete") {
    if (exists) {
      return {
        path: latestEvent.path,
        eventId: latestEvent.eventId,
        expectedHash: null,
        currentHash: await sha256File(filePath),
        reason: "File was recreated after agent deleted it.",
        suggestedAction:
          "Review the file manually. Re-run rollback after resolving the current file state if rollback is intended.",
      };
    }
    return null;
  }

  if (!exists) {
    if (expectedHash !== null) {
      return {
        path: latestEvent.path,
        eventId: latestEvent.eventId,
        expectedHash,
        currentHash: null,
        reason: "File was deleted after agent edited it.",
        suggestedAction:
          "The file no longer exists. Check if deletion was intentional.",
      };
    }
    return null;
  }

  const currentHash = await sha256File(filePath);

  if (currentHash !== expectedHash) {
    return {
      path: latestEvent.path,
      eventId: latestEvent.eventId,
      expectedHash,
      currentHash,
      reason: "File was modified after the agent's last recorded change.",
      suggestedAction:
        "Review current file content. The file has changed since the agent's last edit.",
    };
  }

  return null;
}
