import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ResultRow } from "../lib/types";
import {
  columnFilterKind,
  type ColumnFilterExtents,
  type ColumnFilters,
} from "../lib/columnFilters";
import {
  TABLE_COLUMN_META,
  formatCell,
  visibleColumns,
  type TableColumnConfig,
  type TableColumnId,
  type TableSortField,
} from "../lib/tableColumns";
import { ColumnRangeFilter } from "./ColumnRangeFilter";

export type { TableSortField };

type Props = {
  rows: ResultRow[];
  selectedId: string | null;
  sortField: string;
  sortDir: "asc" | "desc";
  columns: TableColumnConfig[];
  onColumnsChange: (columns: TableColumnConfig[]) => void;
  columnFilters: ColumnFilters;
  onColumnFiltersChange: (filters: ColumnFilters) => void;
  filterExtents: ColumnFilterExtents;
  onSort: (field: TableSortField) => void;
  onSelect: (row: ResultRow) => void;
  onOpenFile: (path: string) => void;
  onOpenFileLocation: (path: string) => void;
  onToggleGroup: (groupKey: string) => void;
  emptyMessage: string;
};

type ContextMenuState = {
  x: number;
  y: number;
  path: string;
};

type HeaderMenuState = {
  x: number;
  y: number;
  columnId: TableColumnId;
};

export function ResultsTable({
  rows,
  selectedId,
  sortField,
  sortDir,
  columns,
  onColumnsChange,
  columnFilters,
  onColumnFiltersChange,
  filterExtents,
  onSort,
  onSelect,
  onOpenFile,
  onOpenFileLocation,
  onToggleGroup,
  emptyMessage,
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [headerMenu, setHeaderMenu] = useState<HeaderMenuState | null>(null);
  const [dragId, setDragId] = useState<TableColumnId | null>(null);
  const shown = visibleColumns(columns);
  const gridTemplate = shown.map((c) => `${c.width}px`).join(" ");
  const totalWidth = shown.reduce((sum, c) => sum + c.width, 0);
  const visibleCount = shown.length;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 32,
    overscan: 12,
  });

  useEffect(() => {
    if (!ctxMenu && !headerMenu) return;
    const close = () => {
      setCtxMenu(null);
      setHeaderMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [ctxMenu, headerMenu]);

  function setWidth(id: TableColumnId, width: number) {
    const min = TABLE_COLUMN_META[id].minWidth;
    onColumnsChange(
      columns.map((c) =>
        c.id === id ? { ...c, width: Math.max(min, Math.round(width)) } : c,
      ),
    );
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

  function moveColumn(fromId: TableColumnId, toId: TableColumnId) {
    if (fromId === toId) return;
    const from = columns.findIndex((c) => c.id === fromId);
    const to = columns.findIndex((c) => c.id === toId);
    if (from < 0 || to < 0) return;
    const next = [...columns];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    onColumnsChange(next);
  }

  function setColumnVisible(id: TableColumnId, visible: boolean) {
    const next = columns.map((c) => (c.id === id ? { ...c, visible } : c));
    if (!next.some((c) => c.visible)) return;
    onColumnsChange(next);
  }

  function setTextFilter(id: TableColumnId, value: string) {
    const next = { ...columnFilters };
    if (!value.trim()) delete next[id];
    else next[id] = { kind: "text", value };
    onColumnFiltersChange(next);
  }

  function setRangeFilter(
    id: TableColumnId,
    min: number | null,
    max: number | null,
  ) {
    const next = { ...columnFilters };
    if (min == null && max == null) delete next[id];
    else next[id] = { kind: "range", min, max };
    onColumnFiltersChange(next);
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
          className={col.id === "path" || col.id === "name" ? "path" : "num"}
          title={
            col.id === "path" || col.id === "name" ? row.file.path : undefined
          }
        >
          {text}
        </div>
      );
    });
  }

  return (
    <div className="table-wrap">
      <div className="table-scroll">
        <div
          className="table-head"
          style={{ width: totalWidth, gridTemplateColumns: gridTemplate }}
        >
          {shown.map((col) => {
            const meta = TABLE_COLUMN_META[col.id];
            const active = meta.sortable && sortField === col.id;
            const arrow = active ? (sortDir === "asc" ? " ▲" : " ▼") : "";
            const filterKind = columnFilterKind(col.id);
            const filter = columnFilters[col.id];
            return (
              <div
                key={col.id}
                className={`table-head-cell ${dragId === col.id ? "dragging" : ""}`}
                draggable
                onDragStart={() => setDragId(col.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragId) moveColumn(dragId, col.id);
                  setDragId(null);
                }}
                onDragEnd={() => setDragId(null)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setCtxMenu(null);
                  setHeaderMenu({
                    x: e.clientX,
                    y: e.clientY,
                    columnId: col.id,
                  });
                }}
              >
                <div className="table-head-label">
                  <span className="drag-handle" title="Drag to reorder">
                    ⋮⋮
                  </span>
                  {meta.sortable ? (
                    <button
                      type="button"
                      className={`sort-head ${active ? "active" : ""}`}
                      onClick={() => onSort(col.id as TableSortField)}
                      title={`Sort by ${meta.label}. Right-click for show/hide.`}
                    >
                      {meta.label}
                      {arrow}
                    </button>
                  ) : (
                    <span title="Right-click for show/hide">{meta.label}</span>
                  )}
                </div>
                {filterKind === "text" && (
                  <input
                    type="text"
                    className="col-filter col-filter-text mono"
                    placeholder="Filter…"
                    value={
                      filter?.kind === "text" ? filter.value : ""
                    }
                    onChange={(e) => setTextFilter(col.id, e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    draggable={false}
                    onDragStart={(e) => e.preventDefault()}
                  />
                )}
                {filterKind === "range" && (
                  <ColumnRangeFilter
                    id={col.id}
                    extent={filterExtents[col.id]}
                    min={filter?.kind === "range" ? filter.min : null}
                    max={filter?.kind === "range" ? filter.max : null}
                    onChange={(min, max) => setRangeFilter(col.id, min, max)}
                  />
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
                    onContextMenu={(e) => {
                      if (row.kind !== "file") return;
                      e.preventDefault();
                      onSelect(row);
                      setHeaderMenu(null);
                      setCtxMenu({
                        x: e.clientX,
                        y: e.clientY,
                        path: row.file.path,
                      });
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
      {ctxMenu && (
        <div
          className="context-menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="context-menu-item"
            onClick={() => {
              onOpenFile(ctxMenu.path);
              setCtxMenu(null);
            }}
          >
            Open
          </button>
          <button
            type="button"
            className="context-menu-item"
            onClick={() => {
              onOpenFileLocation(ctxMenu.path);
              setCtxMenu(null);
            }}
          >
            Open file location
          </button>
        </div>
      )}
      {headerMenu && (
        <div
          className="context-menu column-visibility-menu"
          style={{ left: headerMenu.x, top: headerMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {columns.map((col) => {
            const onlyVisible = col.visible && visibleCount <= 1;
            return (
              <label
                key={col.id}
                className={`context-menu-item column-visibility-item ${
                  onlyVisible ? "is-disabled" : ""
                }`}
              >
                <input
                  type="checkbox"
                  checked={col.visible}
                  disabled={onlyVisible}
                  onChange={() => setColumnVisible(col.id, !col.visible)}
                />
                {TABLE_COLUMN_META[col.id].label}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
