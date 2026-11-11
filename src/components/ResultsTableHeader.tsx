import { createContext, useContext } from "react";
import type { CustomHeaderProps } from "ag-grid-react";
import {
  columnFilterKind,
  type ColumnFilterExtents,
  type ColumnFilters,
} from "../lib/columnFilters";
import {
  TABLE_COLUMN_META,
  type TableColumnId,
  type TableSortField,
} from "../lib/tableColumns";
import { ColumnRangeFilter } from "./ColumnRangeFilter";

export type ResultsGridContext = {
  columnFilters: ColumnFilters;
  onColumnFiltersChange: (filters: ColumnFilters) => void;
  filterExtents: ColumnFilterExtents;
  sortField: string;
  sortDir: "asc" | "desc";
  onSort: (field: TableSortField) => void;
  onHeaderContextMenu: (e: React.MouseEvent, columnId: TableColumnId) => void;
};

export const ResultsTableUiContext = createContext<ResultsGridContext | null>(
  null,
);

export function ResultsTableHeader(_props: CustomHeaderProps) {
  const colId = _props.column.getColId() as TableColumnId;
  const meta = TABLE_COLUMN_META[colId];
  const ctx = useContext(ResultsTableUiContext);
  if (!meta || !ctx) return null;
  const ui = ctx;

  const filterKind = columnFilterKind(colId);
  const filter = ui.columnFilters[colId];
  const active = meta.sortable && ui.sortField === colId;
  const arrow = active ? (ui.sortDir === "asc" ? " ▲" : " ▼") : "";

  function setTextFilter(value: string) {
    const next = { ...ui.columnFilters };
    if (!value.trim()) delete next[colId];
    else next[colId] = { kind: "text", value };
    ui.onColumnFiltersChange(next);
  }

  function setRangeFilter(min: number | null, max: number | null) {
    const next = { ...ui.columnFilters };
    if (min == null && max == null) delete next[colId];
    else next[colId] = { kind: "range", min, max };
    ui.onColumnFiltersChange(next);
  }

  return (
    <div
      className="results-header"
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        ui.onHeaderContextMenu(e, colId);
      }}
    >
      <div className="results-header-label">
        {meta.sortable ? (
          <button
            type="button"
            className={`sort-head ${active ? "active" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              ui.onSort(colId as TableSortField);
            }}
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
          value={filter?.kind === "text" ? filter.value : ""}
          onChange={(e) => setTextFilter(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        />
      )}
      {filterKind === "range" && (
        <ColumnRangeFilter
          id={colId}
          extent={ui.filterExtents[colId]}
          min={filter?.kind === "range" ? filter.min : null}
          max={filter?.kind === "range" ? filter.max : null}
          onChange={setRangeFilter}
        />
      )}
    </div>
  );
}
