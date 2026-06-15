import { SafeFSError } from "../types/index.js";

const RELATIVE_PATTERN = /^(\d+)(m|h|d)$/;

export function parseTimeInput(input: string): Date {
  const trimmed = input.trim();

  const relMatch = trimmed.match(RELATIVE_PATTERN);
  if (relMatch) {
    const value = parseInt(relMatch[1]!, 10);
    if (value <= 0) {
      throw new SafeFSError(
        "INVALID_TIME_FORMAT",
        "Relative time value must be positive."
      );
    }
    const unit = relMatch[2]!;

    const now = new Date();
    let ms = 0;

    switch (unit) {
      case "m":
        ms = value * 60 * 1000;
        break;
      case "h":
        ms = value * 60 * 60 * 1000;
        break;
      case "d":
        ms = value * 24 * 60 * 60 * 1000;
        break;
    }

    return new Date(now.getTime() - ms);
  }

  const isoDate = new Date(trimmed);
  if (!isNaN(isoDate.getTime()) && trimmed.includes("T")) {
    return isoDate;
  }

  throw new SafeFSError(
    "INVALID_TIME_FORMAT",
    `Invalid time format: "${input}". Use 15m, 1h, 3h, 1d, 7d, or an ISO timestamp.`
  );
}
