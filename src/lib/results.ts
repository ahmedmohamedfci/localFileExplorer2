import type { FileRecord, PatternEntry, ResultRow } from "./types";
import {
  compileUserPattern,
  pathMatchesClause,
  pathMatchesUserPattern,
} from "./patterns";

export function enabledPatterns(entries: PatternEntry[]): string[] {
  return entries.filter((e) => e.enabled && e.pattern.trim()).map((e) => e.pattern);
}

export function buildDisplayRows(args: {
  files: FileRecord[];
  includePatterns: PatternEntry[];
  splitBySearch: boolean;
  testPattern: string;
  collapsedGroups: Set<string>;
}): { rows: ResultRow[]; displayedFileCount: number; testError: string | null } {
  const { files, includePatterns, splitBySearch, testPattern, collapsedGroups } = args;
  const testTrim = testPattern.trim();
  let testError: string | null = null;
  if (testTrim) {
    const compiled = compileUserPattern(testTrim);
    if (!compiled.ok) testError = `Invalid pattern: ${compiled.error}`;
  }

  const filtered = testError
    ? []
    : files.filter((f) => pathMatchesUserPattern(f.path, testTrim));

  // Live test hides delimiter/group rows
  if (testTrim && !testError) {
    const rows: ResultRow[] = filtered.map((file, i) => ({
      kind: "file",
      id: `f:${file.path}`,
      playlistIndex: i + 1,
      file,
    }));
    return { rows, displayedFileCount: rows.length, testError };
  }

  const enabled = includePatterns.filter((e) => e.enabled && e.pattern.trim());

  if (!splitBySearch || enabled.length === 0) {
    const rows: ResultRow[] = filtered.map((file, i) => ({
      kind: "file",
      id: `f:${file.path}`,
      playlistIndex: i + 1,
      file,
    }));
    return { rows, displayedFileCount: rows.length, testError };
  }

  const rows: ResultRow[] = [];
  let playlistIndex = 0;
  let displayedFileCount = 0;

  for (const entry of enabled) {
    const compiled = compileUserPattern(entry.pattern);
    if (!compiled.ok) continue;

    const groupFiles = filtered.filter((f) =>
      pathMatchesClause(f.path, compiled.clause),
    );
    const groupKey = entry.pattern;
    const collapsed = collapsedGroups.has(groupKey);
    const label = `000${entry.pattern}(.search)`;

    if (collapsed) {
      rows.push({
        kind: "section",
        id: `sec:${groupKey}`,
        label,
        count: groupFiles.length,
        groupKey,
        collapsed: true,
      });
      continue;
    }

    // Three delimiter rows; first is collapse toggle
    for (let d = 0; d < 3; d++) {
      playlistIndex += 1;
      rows.push({
        kind: "delimiter",
        id: `d:${groupKey}:${d}`,
        label,
        playlistIndex,
        toggle: d === 0 ? "collapse" : undefined,
        groupKey,
      });
    }

    for (const file of groupFiles) {
      playlistIndex += 1;
      displayedFileCount += 1;
      rows.push({
        kind: "file",
        id: `f:${groupKey}:${file.path}`,
        playlistIndex,
        file,
      });
    }
  }

  return { rows, displayedFileCount, testError };
}

export function rowsToPlaylistItems(rows: ResultRow[]): {
  path: string;
  isDelimiter: boolean;
}[] {
  return rows
    .filter((r) => r.kind === "file" || r.kind === "delimiter")
    .map((r) => {
      if (r.kind === "file") {
        return { path: r.file.path, isDelimiter: false };
      }
      return { path: r.label, isDelimiter: false };
    });
}
