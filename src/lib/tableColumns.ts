import type { FileRecord } from "./types";
import { formatDuration, formatSize, formatTimestamp } from "./format";

export type TableColumnId =
  | "index"
  | "path"
  | "ext"
  | "sizeBytes"
  | "durationMs"
  | "mtime"
  | "atime"
  | "birthtime"
  | "indexedAt";

export type TableColumnConfig = {
  id: TableColumnId;
  width: number;
  visible: boolean;
};

export type TableSortField = Exclude<TableColumnId, "index">;

export const TABLE_COLUMN_META: Record<
  TableColumnId,
  { label: string; sortable: boolean; minWidth: number }
> = {
  index: { label: "#", sortable: false, minWidth: 40 },
  path: { label: "Path", sortable: true, minWidth: 120 },
  ext: { label: "Ext", sortable: true, minWidth: 48 },
  sizeBytes: { label: "Size", sortable: true, minWidth: 64 },
  durationMs: { label: "Duration", sortable: true, minWidth: 64 },
  mtime: { label: "Modified", sortable: true, minWidth: 100 },
  atime: { label: "Accessed", sortable: true, minWidth: 100 },
  birthtime: { label: "Created", sortable: true, minWidth: 100 },
  indexedAt: { label: "Indexed", sortable: true, minWidth: 100 },
};

export const DEFAULT_TABLE_COLUMNS: TableColumnConfig[] = [
  { id: "index", width: 56, visible: true },
  { id: "path", width: 480, visible: true },
  { id: "ext", width: 64, visible: true },
  { id: "sizeBytes", width: 84, visible: true },
  { id: "durationMs", width: 84, visible: true },
  { id: "mtime", width: 150, visible: true },
  { id: "atime", width: 150, visible: false },
  { id: "birthtime", width: 150, visible: false },
  { id: "indexedAt", width: 150, visible: false },
];

const ALL_IDS = new Set<string>(DEFAULT_TABLE_COLUMNS.map((c) => c.id));

export function normalizeTableColumns(
  value: unknown,
): TableColumnConfig[] {
  const defaults = DEFAULT_TABLE_COLUMNS.map((c) => ({ ...c }));
  if (!Array.isArray(value)) return defaults;

  const byId = new Map<string, TableColumnConfig>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : "";
    if (!ALL_IDS.has(id)) continue;
    const width =
      typeof o.width === "number" && Number.isFinite(o.width) && o.width > 0
        ? Math.round(o.width)
        : defaults.find((d) => d.id === id)?.width ?? 100;
    byId.set(id, {
      id: id as TableColumnId,
      width,
      visible: o.visible !== false,
    });
  }

  const ordered: TableColumnConfig[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const id = (item as Record<string, unknown>).id;
    if (typeof id === "string" && byId.has(id)) {
      ordered.push(byId.get(id)!);
      byId.delete(id);
    }
  }
  for (const d of defaults) {
    if (!ordered.some((c) => c.id === d.id)) {
      ordered.push(byId.get(d.id) ?? { ...d });
    }
  }
  if (!ordered.some((c) => c.visible)) {
    const path = ordered.find((c) => c.id === "path");
    if (path) path.visible = true;
  }
  return ordered;
}

export function visibleColumns(
  columns: TableColumnConfig[],
): TableColumnConfig[] {
  return columns.filter((c) => c.visible);
}

export function formatCell(
  id: TableColumnId,
  args: { playlistIndex?: number; label?: string; file?: FileRecord },
): string {
  if (id === "index") {
    return args.playlistIndex != null ? String(args.playlistIndex) : "";
  }
  if (!args.file) {
    return id === "path" ? (args.label ?? "") : "";
  }
  const f = args.file;
  switch (id) {
    case "path":
      return f.path;
    case "ext":
      return f.ext;
    case "sizeBytes":
      return formatSize(f.sizeBytes);
    case "durationMs":
      return formatDuration(f.durationMs);
    case "mtime":
      return formatTimestamp(f.mtime);
    case "atime":
      return formatTimestamp(f.atime);
    case "birthtime":
      return formatTimestamp(f.birthtime);
    case "indexedAt":
      return formatTimestamp(f.indexedAt);
    default:
      return "";
  }
}

export function isTableSortField(value: string): value is TableSortField {
  return value !== "index" && value in TABLE_COLUMN_META;
}
