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

/** Hierarchical path compare — avoids localeCompare ignoring separators. */
export function comparePathStrings(a: string, b: string): number {
  const ap = pathSegments(a);
  const bp = pathSegments(b);
  const n = Math.min(ap.length, bp.length);
  for (let i = 0; i < n; i++) {
    if (ap[i] !== bp[i]) {
      return ap[i]! < bp[i]! ? -1 : 1;
    }
  }
  return ap.length - bp.length;
}

function compareNames(a: string, b: string): number {
  const an = fileNameOf(a);
  const bn = fileNameOf(b);
  return an < bn ? -1 : an > bn ? 1 : 0;
}

/**
 * Path-aware secondary ordering:
 * - discardPath on → name first (same names cluster), then full path
 * - discardPath off → full path (directory groups, name within folder)
 */
function comparePathAware(aPath: string, bPath: string, discardPath: boolean): number {
  if (discardPath) {
    return compareNames(aPath, bPath) || comparePathStrings(aPath, bPath);
  }
  return comparePathStrings(aPath, bPath);
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
      // Name/path both use path-aware ordering; discardPath flips name-first vs path-first.
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
