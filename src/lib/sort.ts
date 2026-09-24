import type { FileRecord } from "./types";

/** Client-side sort of already-loaded results (table header clicks). */
export function sortFileRecords(
  files: FileRecord[],
  sortField: string,
  sortDir: "asc" | "desc",
  discardPath = false,
): FileRecord[] {
  const out = [...files];
  if (sortField === "random") {
    // Keep current order for random — reshuffle only via Apply filter
    return out;
  }

  const desc = sortDir === "desc";
  out.sort((a, b) => {
    const ord = compare(a, b, sortField, discardPath);
    return desc ? -ord : ord;
  });
  return out;
}

/** Split path into lowercase segments (handles \ and /). */
export function pathSegments(path: string): string[] {
  return path
    .replace(/\\/g, "/")
    .toLowerCase()
    .split("/")
    .filter((s) => s.length > 0);
}

/** File name (last segment), lowercase. */
export function fileNameOf(path: string): string {
  const parts = pathSegments(path);
  return parts.length > 0 ? parts[parts.length - 1]! : "";
}

/** Parent directory segments (everything except the file name). */
export function parentSegments(path: string): string[] {
  const parts = pathSegments(path);
  return parts.length > 1 ? parts.slice(0, -1) : [];
}

/** Hierarchical segment-list compare. */
export function compareSegments(ap: string[], bp: string[]): number {
  const n = Math.min(ap.length, bp.length);
  for (let i = 0; i < n; i++) {
    if (ap[i] !== bp[i]) {
      return ap[i]! < bp[i]! ? -1 : 1;
    }
  }
  return ap.length - bp.length;
}

/** Hierarchical full-path compare — avoids localeCompare ignoring separators. */
export function comparePathStrings(a: string, b: string): number {
  return compareSegments(pathSegments(a), pathSegments(b));
}

function compareNames(a: string, b: string): number {
  const an = fileNameOf(a);
  const bn = fileNameOf(b);
  return an < bn ? -1 : an > bn ? 1 : 0;
}

function compareParents(a: string, b: string): number {
  return compareSegments(parentSegments(a), parentSegments(b));
}

/**
 * Path-aware ordering used as primary for path/name sorts, or as a tiebreak:
 * - discardPath on → file name first (same names cluster), then full path
 * - discardPath off → parent directory first (same folder stays together), then name
 */
export function comparePathAware(
  aPath: string,
  bPath: string,
  discardPath: boolean,
): number {
  if (discardPath) {
    return compareNames(aPath, bPath) || comparePathStrings(aPath, bPath);
  }
  return (
    compareParents(aPath, bPath) ||
    compareNames(aPath, bPath) ||
    comparePathStrings(aPath, bPath)
  );
}

function compare(
  a: FileRecord,
  b: FileRecord,
  field: string,
  discardPath: boolean,
): number {
  switch (field) {
    case "name":
    case "path":
      return comparePathAware(a.path, b.path, discardPath);
    case "ext": {
      const ae = a.ext.toLowerCase();
      const be = b.ext.toLowerCase();
      return (ae < be ? -1 : ae > be ? 1 : 0) || comparePathAware(a.path, b.path, discardPath);
    }
    case "sizeBytes":
      return a.sizeBytes - b.sizeBytes || comparePathAware(a.path, b.path, discardPath);
    case "durationMs": {
      const ad = a.durationMs ?? Number.POSITIVE_INFINITY;
      const bd = b.durationMs ?? Number.POSITIVE_INFINITY;
      return ad - bd || comparePathAware(a.path, b.path, discardPath);
    }
    case "mtime":
    case "atime":
    case "birthtime":
    case "indexedAt": {
      const key = field as "mtime" | "atime" | "birthtime" | "indexedAt";
      return a[key] - b[key] || comparePathAware(a.path, b.path, discardPath);
    }
    default:
      return comparePathAware(a.path, b.path, discardPath);
  }
}
