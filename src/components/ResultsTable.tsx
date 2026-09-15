import { useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ResultRow } from "../lib/types";
import { formatDuration, formatSize, formatTimestamp } from "../lib/format";

export type TableSortField =
  | "path"
  | "ext"
  | "sizeBytes"
  | "durationMs"
  | "mtime";

type Props = {
  rows: ResultRow[];
  selectedId: string | null;
  sortField: string;
  sortDir: "asc" | "desc";
  enableTags?: boolean;
  onSort: (field: TableSortField) => void;
  onSelect: (row: ResultRow) => void;
  onOpenFile: (path: string) => void;
  onToggleGroup: (groupKey: string) => void;
  onAddTag?: (path: string, tag: string) => void;
  onRemoveTag?: (path: string, tag: string) => void;
  emptyMessage: string;
};

const BASE_COLUMNS: { field: TableSortField | null; label: string }[] = [
  { field: null, label: "#" },
  { field: "path", label: "Path" },
  { field: "ext", label: "Ext" },
  { field: "sizeBytes", label: "Size" },
  { field: "durationMs", label: "Duration" },
  { field: "mtime", label: "Modified" },
];

export function ResultsTable({
  rows,
  selectedId,
  sortField,
  sortDir,
  enableTags = false,
  onSort,
  onSelect,
  onOpenFile,
  onToggleGroup,
  onAddTag,
  onRemoveTag,
  emptyMessage,
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => (enableTags ? 36 : 32),
    overscan: 12,
  });

  const columns = enableTags
    ? [
        ...BASE_COLUMNS.slice(0, 2),
        { field: null, label: "Tags" },
        ...BASE_COLUMNS.slice(2),
      ]
    : BASE_COLUMNS;

  const emptyCells = enableTags ? 5 : 4;

  return (
    <div className={`table-wrap ${enableTags ? "with-tags" : ""}`}>
      <div className="table-head">
        {columns.map((col, i) => {
          if (!col.field) {
            return <div key={`${col.label}-${i}`}>{col.label}</div>;
          }
          const active = sortField === col.field;
          const arrow = active ? (sortDir === "asc" ? " ▲" : " ▼") : "";
          return (
            <button
              key={col.field}
              type="button"
              className={`sort-head ${active ? "active" : ""}`}
              onClick={() => onSort(col.field!)}
              title={`Sort by ${col.label}`}
            >
              {col.label}
              {arrow}
            </button>
          );
        })}
      </div>
      <div
        className="table-body"
        ref={parentRef}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || !selectedId) return;
          const row = rows.find((r) => r.id === selectedId);
          if (row?.kind === "file") onOpenFile(row.file.path);
        }}
      >
        {rows.length === 0 ? (
          <div className="table-empty">{emptyMessage}</div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index];
              const selected = row.id === selectedId;
              if (row.kind === "section") {
                return (
                  <div
                    key={row.id}
                    className="table-row section"
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${item.start}px)`,
                    }}
                    onClick={() => onToggleGroup(row.groupKey)}
                  >
                    <div className="num">▶</div>
                    <div className="path">
                      {row.label} ({row.count})
                    </div>
                    {enableTags && <div />}
                    {Array.from({ length: emptyCells }, (_, i) => (
                      <div key={i} />
                    ))}
                  </div>
                );
              }
              if (row.kind === "delimiter") {
                return (
                  <div
                    key={row.id}
                    className={`table-row delimiter ${selected ? "selected" : ""}`}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${item.start}px)`,
                    }}
                    onClick={() => {
                      onSelect(row);
                      if (row.toggle === "collapse" && row.groupKey) {
                        onToggleGroup(row.groupKey);
                      }
                    }}
                  >
                    <div className="num">
                      {row.toggle === "collapse" ? "▼" : row.playlistIndex}
                    </div>
                    <div className="path">{row.label}</div>
                    {enableTags && <div />}
                    {Array.from({ length: emptyCells }, (_, i) => (
                      <div key={i} />
                    ))}
                  </div>
                );
              }
              return (
                <div
                  key={row.id}
                  className={`table-row ${selected ? "selected" : ""}`}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${item.start}px)`,
                  }}
                  title={row.file.path}
                  onClick={() => onSelect(row)}
                  onDoubleClick={() => onOpenFile(row.file.path)}
                >
                  <div className="num">{row.playlistIndex}</div>
                  <div className="path">{row.file.path}</div>
                  {enableTags && (
                    <TagsCell
                      path={row.file.path}
                      tags={row.file.tags ?? []}
                      onAddTag={onAddTag}
                      onRemoveTag={onRemoveTag}
                    />
                  )}
                  <div className="num">{row.file.ext}</div>
                  <div className="num">{formatSize(row.file.sizeBytes)}</div>
                  <div className="num">{formatDuration(row.file.durationMs)}</div>
                  <div className="num">{formatTimestamp(row.file.mtime)}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function TagsCell({
  path,
  tags,
  onAddTag,
  onRemoveTag,
}: {
  path: string;
  tags: string[];
  onAddTag?: (path: string, tag: string) => void;
  onRemoveTag?: (path: string, tag: string) => void;
}) {
  const [draft, setDraft] = useState("");

  function stop(e: MouseEvent | KeyboardEvent) {
    e.stopPropagation();
  }

  function submit() {
    const tag = draft.trim();
    if (!tag || !onAddTag) return;
    onAddTag(path, tag);
    setDraft("");
  }

  return (
    <div className="tags-cell" onClick={stop} onDoubleClick={stop}>
      <div className="tag-list">
        {tags.map((tag) => (
          <span key={tag.toLowerCase()} className="tag-chip" title={tag}>
            <span className="tag-label">{tag}</span>
            {onRemoveTag && (
              <button
                type="button"
                className="tag-remove"
                title={`Remove ${tag}`}
                onClick={(e) => {
                  stop(e);
                  onRemoveTag(path, tag);
                }}
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>
      {onAddTag && (
        <input
          className="tag-input"
          value={draft}
          placeholder="+"
          title="Add tag"
          onChange={(e) => setDraft(e.target.value)}
          onClick={stop}
          onDoubleClick={stop}
          onKeyDown={(e) => {
            stop(e);
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          onBlur={() => {
            if (draft.trim()) submit();
          }}
        />
      )}
    </div>
  );
}
