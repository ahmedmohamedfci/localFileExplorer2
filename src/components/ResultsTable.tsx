import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ResultRow } from "../lib/types";
import {
  TABLE_COLUMN_META,
  formatCell,
  visibleColumns,
  type TableColumnConfig,
  type TableColumnId,
  type TableSortField,
} from "../lib/tableColumns";

export type { TableSortField };

type Props = {
  rows: ResultRow[];
  selectedId: string | null;
  sortField: string;
  sortDir: "asc" | "desc";
  columns: TableColumnConfig[];
  onColumnsChange: (columns: TableColumnConfig[]) => void;
  onSort: (field: TableSortField) => void;
  onSelect: (row: ResultRow) => void;
  onOpenFile: (path: string) => void;
  onToggleGroup: (groupKey: string) => void;
  emptyMessage: string;
};

export function ResultsTable({
  rows,
  selectedId,
  sortField,
  sortDir,
  columns,
  onColumnsChange,
  onSort,
  onSelect,
  onOpenFile,
  onToggleGroup,
  emptyMessage,
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const shown = visibleColumns(columns);
  const gridTemplate = shown.map((c) => `${c.width}px`).join(" ");
  const totalWidth = shown.reduce((sum, c) => sum + c.width, 0);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 32,
    overscan: 12,
  });

  useEffect(() => {
    if (!pickerOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!pickerRef.current?.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [pickerOpen]);

  function setWidth(id: TableColumnId, width: number) {
    const min = TABLE_COLUMN_META[id].minWidth;
    onColumnsChange(
      columns.map((c) =>
        c.id === id ? { ...c, width: Math.max(min, Math.round(width)) } : c,
      ),
    );
  }

  function toggleVisible(id: TableColumnId) {
    const next = columns.map((c) =>
      c.id === id ? { ...c, visible: !c.visible } : c,
    );
    if (!next.some((c) => c.visible)) return;
    onColumnsChange(next);
  }

  function onResizeStart(
    e: React.MouseEvent,
    id: TableColumnId,
    startWidth: number,
  ) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const onMove = (ev: MouseEvent) => {
      setWidth(id, startWidth + (ev.clientX - startX));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function renderCells(row: ResultRow) {
    return shown.map((col) => {
      if (row.kind === "section") {
        if (col.id === "index") {
          return (
            <div key={col.id} className="num">
              ▶
            </div>
          );
        }
        if (col.id === "path") {
          return (
            <div key={col.id} className="path">
              {row.label} ({row.count})
            </div>
          );
        }
        return <div key={col.id} />;
      }
      if (row.kind === "delimiter") {
        if (col.id === "index") {
          return (
            <div key={col.id} className="num">
              {row.toggle === "collapse" ? "▼" : row.playlistIndex}
            </div>
          );
        }
        if (col.id === "path") {
          return (
            <div key={col.id} className="path">
              {row.label}
            </div>
          );
        }
        return <div key={col.id} />;
      }
      const text = formatCell(col.id, {
        playlistIndex: row.playlistIndex,
        file: row.file,
      });
      return (
        <div
          key={col.id}
          className={col.id === "path" ? "path" : "num"}
          title={col.id === "path" ? row.file.path : undefined}
        >
          {text}
        </div>
      );
    });
  }

  return (
    <div className="table-wrap">
      <div className="table-toolbar">
        <div className="column-picker" ref={pickerRef}>
          <button
            type="button"
            className="btn"
            onClick={() => setPickerOpen((v) => !v)}
          >
            Columns
          </button>
          {pickerOpen && (
            <div className="column-picker-menu">
              <div className="hint" style={{ marginBottom: 6 }}>
                Show or hide fields from the catalog.
              </div>
              {columns.map((col) => (
                <label key={col.id} className="inline column-picker-item">
                  <input
                    type="checkbox"
                    checked={col.visible}
                    onChange={() => toggleVisible(col.id)}
                  />
                  {TABLE_COLUMN_META[col.id].label}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="table-scroll">
        <div className="table-head" style={{ width: totalWidth, gridTemplateColumns: gridTemplate }}>
          {shown.map((col) => {
            const meta = TABLE_COLUMN_META[col.id];
            const active = meta.sortable && sortField === col.id;
            const arrow = active ? (sortDir === "asc" ? " ▲" : " ▼") : "";
            return (
              <div key={col.id} className="table-head-cell">
                {meta.sortable ? (
                  <button
                    type="button"
                    className={`sort-head ${active ? "active" : ""}`}
                    onClick={() => onSort(col.id as TableSortField)}
                    title={`Sort by ${meta.label}`}
                  >
                    {meta.label}
                    {arrow}
                  </button>
                ) : (
                  <span>{meta.label}</span>
                )}
                <span
                  className="col-resizer"
                  onMouseDown={(e) => onResizeStart(e, col.id, col.width)}
                  title="Drag to resize"
                />
              </div>
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
            <div
              style={{
                height: virtualizer.getTotalSize(),
                position: "relative",
                width: totalWidth,
              }}
            >
              {virtualizer.getVirtualItems().map((item) => {
                const row = rows[item.index];
                const selected = row.id === selectedId;
                const kindClass =
                  row.kind === "section"
                    ? "section"
                    : row.kind === "delimiter"
                      ? "delimiter"
                      : "";
                return (
                  <div
                    key={row.id}
                    className={`table-row ${kindClass} ${selected ? "selected" : ""}`}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: totalWidth,
                      gridTemplateColumns: gridTemplate,
                      transform: `translateY(${item.start}px)`,
                    }}
                    title={row.kind === "file" ? row.file.path : undefined}
                    onClick={() => {
                      if (row.kind === "section") {
                        onToggleGroup(row.groupKey);
                        return;
                      }
                      onSelect(row);
                      if (
                        row.kind === "delimiter" &&
                        row.toggle === "collapse" &&
                        row.groupKey
                      ) {
                        onToggleGroup(row.groupKey);
                      }
                    }}
                    onDoubleClick={() => {
                      if (row.kind === "file") onOpenFile(row.file.path);
                    }}
                  >
                    {renderCells(row)}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
