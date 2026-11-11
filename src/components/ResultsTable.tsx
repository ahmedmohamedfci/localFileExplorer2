import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  themeQuartz,
  type CellDoubleClickedEvent,
  type CellKeyDownEvent,
  type ColDef,
  type ColumnMovedEvent,
  type ColumnResizedEvent,
  type ColumnVisibleEvent,
  type GetRowIdParams,
  type GridApi,
  type GridReadyEvent,
  type RowClassParams,
  type RowClickedEvent,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import type { ResultRow } from "../lib/types";
import {
  type ColumnFilterExtents,
  type ColumnFilters,
} from "../lib/columnFilters";
import { fileName } from "../lib/format";
import {
  TABLE_COLUMN_META,
  formatCell,
  type TableColumnConfig,
  type TableColumnId,
  type TableSortField,
} from "../lib/tableColumns";
import {
  ResultsTableHeader,
  ResultsTableUiContext,
  type ResultsGridContext,
} from "./ResultsTableHeader";

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
};

const gridTheme = themeQuartz.withParams({
  backgroundColor: "#1a1d21",
  foregroundColor: "#e8eaed",
  chromeBackgroundColor: "#22262c",
  headerBackgroundColor: "#22262c",
  headerTextColor: "#9aa3af",
  oddRowBackgroundColor: "#1a1d21",
  rowHoverColor: "#30363f",
  selectedRowBackgroundColor: "#2a3a4d",
  borderColor: "#3a414c",
  wrapperBorder: false,
  fontFamily: "Segoe UI, Candara, Gill Sans, sans-serif",
  fontSize: 12,
  headerFontSize: 11,
  spacing: 4,
  rowHeight: 32,
  headerHeight: 68,
  cellHorizontalPadding: 8,
});

function cellText(colId: TableColumnId, row: ResultRow): string {
  if (row.kind === "section") {
    if (colId === "index") return "▶";
    if (colId === "path" || colId === "name") {
      return `${row.label} (${row.count})`;
    }
    return "";
  }
  if (row.kind === "delimiter") {
    if (colId === "index") {
      return row.toggle === "collapse" ? "▼" : String(row.playlistIndex);
    }
    if (colId === "path" || colId === "name") return row.label;
    return "";
  }
  // Filename is always the basename of path — independent of Path column visibility.
  if (colId === "name") return fileName(row.file.path);
  return formatCell(colId, {
    playlistIndex: row.playlistIndex,
    file: row.file,
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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
  const apiRef = useRef<GridApi<ResultRow> | null>(null);
  const syncingColumns = useRef(false);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [headerMenu, setHeaderMenu] = useState<HeaderMenuState | null>(null);
  const visibleCount = columns.filter((c) => c.visible).length;

  const onHeaderContextMenu = useCallback(
    (e: React.MouseEvent, _columnId: TableColumnId) => {
      setCtxMenu(null);
      setHeaderMenu({ x: e.clientX, y: e.clientY });
    },
    [],
  );

  const gridContext = useMemo<ResultsGridContext>(
    () => ({
      columnFilters,
      onColumnFiltersChange,
      filterExtents,
      sortField,
      sortDir,
      onSort,
      onHeaderContextMenu,
    }),
    [
      columnFilters,
      onColumnFiltersChange,
      filterExtents,
      sortField,
      sortDir,
      onSort,
      onHeaderContextMenu,
    ],
  );

  const columnDefs = useMemo<ColDef<ResultRow>[]>(() => {
    return columns.map((col) => {
      const meta = TABLE_COLUMN_META[col.id];
      return {
        colId: col.id,
        headerName: meta.label,
        width: col.width,
        minWidth: meta.minWidth,
        hide: !col.visible,
        // Parent owns sort order; header button calls onSort via context.
        sortable: false,
        resizable: true,
        suppressHeaderFilterButton: true,
        suppressHeaderMenuButton: true,
        headerComponent: ResultsTableHeader,
        valueGetter: (p) => {
          if (!p.data) return "";
          return cellText(col.id, p.data);
        },
        tooltipValueGetter: (p) => {
          if (!p.data || p.data.kind !== "file") return undefined;
          if (col.id === "path" || col.id === "name") return p.data.file.path;
          return undefined;
        },
        cellClass:
          col.id === "path" || col.id === "name" ? "cell-path" : "cell-num",
      };
    });
  }, [columns]);

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

  useEffect(() => {
    const api = apiRef.current;
    if (!api || api.isDestroyed()) return;
    api.redrawRows();
  }, [selectedId]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api || api.isDestroyed()) return;
    syncingColumns.current = true;
    const state = columns.map((c) => ({
      colId: c.id,
      width: c.width,
      hide: !c.visible,
    }));
    api.applyColumnState({ state, applyOrder: true });
    syncingColumns.current = false;
  }, [columns]);

  function readColumnsFromGrid(api: GridApi<ResultRow>): TableColumnConfig[] {
    const ordered = api.getColumnState();
    const byId = new Map(columns.map((c) => [c.id, c]));
    const next: TableColumnConfig[] = [];
    for (const s of ordered) {
      const id = s.colId as TableColumnId;
      const prev = byId.get(id);
      if (!prev) continue;
      next.push({
        id,
        width: Math.round(s.width ?? prev.width),
        visible: !s.hide,
      });
      byId.delete(id);
    }
    for (const leftover of byId.values()) next.push(leftover);
    if (!next.some((c) => c.visible)) {
      const path = next.find((c) => c.id === "path");
      if (path) path.visible = true;
    }
    return next;
  }

  function onGridReady(e: GridReadyEvent<ResultRow>) {
    apiRef.current = e.api;
  }

  function onColumnResized(e: ColumnResizedEvent<ResultRow>) {
    if (syncingColumns.current || !e.finished || !e.column) return;
    onColumnsChange(readColumnsFromGrid(e.api));
  }

  function onColumnMoved(e: ColumnMovedEvent<ResultRow>) {
    if (syncingColumns.current || !e.finished) return;
    onColumnsChange(readColumnsFromGrid(e.api));
  }

  function onColumnVisible(e: ColumnVisibleEvent<ResultRow>) {
    if (syncingColumns.current) return;
    onColumnsChange(readColumnsFromGrid(e.api));
  }

  function onRowClicked(e: RowClickedEvent<ResultRow>) {
    const row = e.data;
    if (!row) return;
    if (row.kind === "section") {
      onToggleGroup(row.groupKey);
      return;
    }
    onSelect(row);
    if (row.kind === "delimiter" && row.toggle === "collapse" && row.groupKey) {
      onToggleGroup(row.groupKey);
    }
  }

  function onCellDoubleClicked(e: CellDoubleClickedEvent<ResultRow>) {
    const row = e.data;
    if (row?.kind === "file") onOpenFile(row.file.path);
  }

  function onCellKeyDown(e: CellKeyDownEvent<ResultRow>) {
    const ke = e.event as KeyboardEvent | undefined;
    if (!ke || ke.key !== "Enter" || !selectedId) return;
    const row = rows.find((r) => r.id === selectedId);
    if (row?.kind === "file") onOpenFile(row.file.path);
  }

  function setColumnVisible(id: TableColumnId, visible: boolean) {
    const next = columns.map((c) => (c.id === id ? { ...c, visible } : c));
    if (!next.some((c) => c.visible)) return;
    onColumnsChange(next);
  }

  const getRowId = useCallback(
    (p: GetRowIdParams<ResultRow>) => p.data.id,
    [],
  );

  const getRowClass = useCallback(
    (p: RowClassParams<ResultRow>) => {
      const classes: string[] = [];
      if (p.data?.kind === "section") classes.push("row-section");
      if (p.data?.kind === "delimiter") classes.push("row-delimiter");
      if (p.data?.id === selectedId) classes.push("row-selected");
      return classes.join(" ");
    },
    [selectedId],
  );

  return (
    <ResultsTableUiContext.Provider value={gridContext}>
    <div className="table-wrap">
      <div className="table-grid">
        <AgGridReact<ResultRow>
          theme={gridTheme}
          rowData={rows}
          columnDefs={columnDefs}
          context={gridContext}
          getRowId={getRowId}
          getRowClass={getRowClass}
          animateRows={false}
          ensureDomOrder
          tooltipShowDelay={400}
          preventDefaultOnContextMenu
          onGridReady={onGridReady}
          onColumnResized={onColumnResized}
          onColumnMoved={onColumnMoved}
          onColumnVisible={onColumnVisible}
          onRowClicked={onRowClicked}
          onCellDoubleClicked={onCellDoubleClicked}
          onCellKeyDown={onCellKeyDown}
          onCellContextMenu={(e) => {
            const row = e.data;
            if (row?.kind !== "file") return;
            const mouse = e.event as MouseEvent | undefined;
            if (!mouse) return;
            mouse.preventDefault();
            onSelect(row);
            setHeaderMenu(null);
            setCtxMenu({
              x: mouse.clientX,
              y: mouse.clientY,
              path: row.file.path,
            });
          }}
          overlayNoRowsTemplate={`<span class="table-empty">${escapeHtml(emptyMessage)}</span>`}
        />
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
    </ResultsTableUiContext.Provider>
  );
}
