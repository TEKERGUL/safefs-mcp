import { SafeFSError } from "../types/index.js";

export interface PatchResult {
  patched: string;
  lineStart: number;
  lineEnd: number;
  leadingContext: string;
  trailingContext: string;
}

export function applyPatch(options: {
  content: string;
  search: string;
  replace: string;
  replaceAll?: boolean;
  maxSearchLength: number;
}): PatchResult {
  const { content, search, replace, replaceAll = false, maxSearchLength } = options;

  if (search.length > maxSearchLength) {
    throw new SafeFSError(
      "VALIDATION_ERROR",
      `Search string exceeds maximum length of ${maxSearchLength} characters.`
    );
  }

  const normContent = content.replace(/\r\n/g, "\n");
  const normSearch = search.replace(/\r\n/g, "\n");
  const normReplace = replace.replace(/\r\n/g, "\n");

  const firstIndex = normContent.indexOf(normSearch);
  if (firstIndex === -1) {
    throw new SafeFSError(
      "SEARCH_NOT_FOUND",
      "Search string not found in file content."
    );
  }

  if (!replaceAll) {
    const secondIndex = normContent.indexOf(normSearch, firstIndex + 1);
    if (secondIndex !== -1) {
      throw new SafeFSError(
        "AMBIGUOUS_PATCH",
        "Search string matches multiple locations. Use replaceAll: true or provide a more specific search."
      );
    }
  }

  const lines = normContent.split("\n");
  const beforeMatch = normContent.slice(0, firstIndex);
  const lineStart = beforeMatch.split("\n").length;
  const matchLines = normSearch.split("\n").length;
  const lineEnd = lineStart + matchLines - 1;

  const contextLines = 3;
  const leadingStart = Math.max(0, lineStart - 1 - contextLines);
  const leadingContext = lines.slice(leadingStart, lineStart - 1).join("\n");
  const trailingEnd = Math.min(lines.length, lineEnd + contextLines);
  const trailingContext = lines.slice(lineEnd, trailingEnd).join("\n");

  let patched: string;
  if (replaceAll) {
    patched = normContent.split(normSearch).join(normReplace);
  } else {
    patched =
      normContent.slice(0, firstIndex) +
      normReplace +
      normContent.slice(firstIndex + normSearch.length);
  }

  return {
    patched,
    lineStart,
    lineEnd,
    leadingContext,
    trailingContext,
  };
}
