import type { FileRecord } from "./types";

/** Client-side sort of already-loaded results (table header clicks). */
export function sortFileRecords(
  files: FileRecord[],
  sortField: string,
  sortDir: "asc" | "desc",
): FileRecord[] {
  const out = [...files];
  if (sortField === "random") {
    // Keep current order for random — reshuffle only via Apply filter
    return out;
  }

  const desc = sortDir === "desc";
  out.sort((a, b) => {
    const ord = compare(a, b, sortField);
    return desc ? -ord : ord;
  });
  return out;
}

function compare(a: FileRecord, b: FileRecord, field: string): number {
  switch (field) {
    case "ext":
      return (
        a.ext.toLowerCase().localeCompare(b.ext.toLowerCase()) ||
        a.path.toLowerCase().localeCompare(b.path.toLowerCase())
      );
    case "sizeBytes":
      return (
        a.sizeBytes - b.sizeBytes ||
        a.path.toLowerCase().localeCompare(b.path.toLowerCase())
      );
    case "durationMs": {
      const ad = a.durationMs ?? Number.POSITIVE_INFINITY;
      const bd = b.durationMs ?? Number.POSITIVE_INFINITY;
      return ad - bd || a.path.toLowerCase().localeCompare(b.path.toLowerCase());
    }
    case "mtime":
    case "atime":
    case "birthtime":
    case "indexedAt": {
      const key = field as "mtime" | "atime" | "birthtime" | "indexedAt";
      return (
        a[key] - b[key] ||
        a.path.toLowerCase().localeCompare(b.path.toLowerCase())
      );
    }
    default:
      return a.path.toLowerCase().localeCompare(b.path.toLowerCase());
  }
}
