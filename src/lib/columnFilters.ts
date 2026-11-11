import { fileName, formatDuration } from "./format";
import { formatCell, type TableColumnId } from "./tableColumns";
import type { FileRecord } from "./types";

export type ColumnRangeFilter = {
  kind: "range";
  min: number | null;
  max: number | null;
};

export type ColumnTextFilter = {
  kind: "text";
  value: string;
};

export type ColumnFilter = ColumnRangeFilter | ColumnTextFilter;

export type ColumnFilters = Partial<Record<TableColumnId, ColumnFilter>>;

export type ColumnFilterKind = "none" | "text" | "range";

export function columnFilterKind(id: TableColumnId): ColumnFilterKind {
  switch (id) {
    case "index":
      return "none";
    case "durationMs":
    case "mtime":
    case "atime":
    case "birthtime":
    case "indexedAt":
      return "range";
    default:
      return "text";
  }
}

export type RangeExtent = { min: number; max: number };

export type ColumnFilterExtents = Partial<
  Record<TableColumnId, RangeExtent>
>;

function numericValue(id: TableColumnId, file: FileRecord): number | null {
  switch (id) {
    case "durationMs":
      return file.durationMs == null || !Number.isFinite(file.durationMs)
        ? 0
        : file.durationMs;
    case "mtime":
      return Number.isFinite(file.mtime) ? file.mtime : null;
    case "atime":
      return Number.isFinite(file.atime) ? file.atime : null;
    case "birthtime":
      return Number.isFinite(file.birthtime) ? file.birthtime : null;
    case "indexedAt":
      return Number.isFinite(file.indexedAt) ? file.indexedAt : null;
    default:
      return null;
  }
}

export function computeColumnExtents(
  files: FileRecord[],
): ColumnFilterExtents {
  const ids: TableColumnId[] = [
    "durationMs",
    "mtime",
    "atime",
    "birthtime",
    "indexedAt",
  ];
  const out: ColumnFilterExtents = {};
  for (const id of ids) {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const file of files) {
      const v = numericValue(id, file);
      if (v == null || !Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (Number.isFinite(min) && Number.isFinite(max)) {
      out[id] = { min, max: max < min ? min : max };
    }
  }
  return out;
}

function textHaystack(id: TableColumnId, file: FileRecord): string {
  if (id === "path") return file.path;
  if (id === "name") return fileName(file.path);
  if (id === "ext") return file.ext;
  if (id === "sizeBytes") {
    return `${file.sizeBytes} ${formatCell("sizeBytes", { file })}`;
  }
  return formatCell(id, { file });
}

export function fileMatchesColumnFilters(
  file: FileRecord,
  filters: ColumnFilters,
): boolean {
  for (const [rawId, filter] of Object.entries(filters)) {
    if (!filter) continue;
    const id = rawId as TableColumnId;
    if (filter.kind === "text") {
      const q = filter.value.trim().toLowerCase();
      if (!q) continue;
      if (!textHaystack(id, file).toLowerCase().includes(q)) return false;
      continue;
    }
    const v = numericValue(id, file);
    if (v == null) return false;
    if (filter.min != null && v < filter.min) return false;
    if (filter.max != null && v > filter.max) return false;
  }
  return true;
}

export function formatRangeBound(id: TableColumnId, value: number): string {
  if (id === "durationMs") return formatDuration(value);
  if (!Number.isFinite(value) || value <= 0) return "—";
  try {
    return new Date(value * 1000).toLocaleDateString();
  } catch {
    return "—";
  }
}

export function emptyColumnFilters(): ColumnFilters {
  return {};
}
