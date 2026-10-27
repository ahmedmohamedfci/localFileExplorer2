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
  /** 0 = no cap. With split, applied per section; otherwise to the whole list. */
  numFiles: number;
  testPattern: string;
  collapsedGroups: Set<string>;
}): { rows: ResultRow[]; displayedFileCount: number; testError: string | null } {
  const { files, includePatterns, splitBySearch, numFiles, testPattern, collapsedGroups } =
    args;
  const limit = fileLimit(numFiles);
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
    const shown = takeLimited(filtered, limit);
    const rows: ResultRow[] = shown.map((file, i) => ({
      kind: "file",
      id: `f:${file.path}`,
      playlistIndex: i + 1,
      file,
    }));
    return { rows, displayedFileCount: rows.length, testError };
  }

  const enabled = includePatterns.filter((e) => e.enabled && e.pattern.trim());

  if (!splitBySearch || enabled.length === 0) {
    const shown = takeLimited(filtered, limit);
    const rows: ResultRow[] = shown.map((file, i) => ({
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

    const groupFiles = takeLimited(
      filtered.filter((f) => pathMatchesClause(f.path, compiled.clause)),
      limit,
    );
    const groupKey = entry.pattern;
    const collapsed = collapsedGroups.has(groupKey);
    const listName = entry.pattern.replace(/[/\\]/g, "");
    const label = `000${listName}(.search)`;

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

/** Real files in playlist order, without delimiter labels or duplicate paths. */
export function playlistFilePaths(rows: ResultRow[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    if (row.kind !== "file" || seen.has(row.file.path)) continue;
    seen.add(row.file.path);
    out.push(row.file.path);
  }
  return out;
}

/** Positive integers cap the list. 0 and invalid values mean unlimited. */
function fileLimit(numFiles: number): number | null {
  if (!Number.isFinite(numFiles) || numFiles <= 0) return null;
  return Math.floor(numFiles);
}

function takeLimited<T>(items: T[], limit: number | null): T[] {
  if (limit == null) return items;
  return items.slice(0, limit);
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
