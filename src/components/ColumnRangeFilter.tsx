import {
  formatRangeBound,
  type RangeExtent,
} from "../lib/columnFilters";
import type { TableColumnId } from "../lib/tableColumns";

type Props = {
  id: TableColumnId;
  extent: RangeExtent | undefined;
  min: number | null;
  max: number | null;
  onChange: (min: number | null, max: number | null) => void;
};

/** Compact dual-thumb range for duration / date columns. */
export function ColumnRangeFilter({
  id,
  extent,
  min,
  max,
  onChange,
}: Props) {
  if (!extent || extent.max <= extent.min) {
    return (
      <div className="col-filter col-filter-range is-empty" title="No range">
        —
      </div>
    );
  }

  const range = extent;
  const lo = min ?? range.min;
  const hi = max ?? range.max;
  const span = range.max - range.min || 1;

  function commit(nextLo: number, nextHi: number) {
    const nextMin = nextLo <= range.min ? null : nextLo;
    const nextMax = nextHi >= range.max ? null : nextHi;
    onChange(nextMin, nextMax);
  }

  function setLo(next: number) {
    commit(Math.min(Math.max(next, range.min), hi), hi);
  }

  function setHi(next: number) {
    commit(lo, Math.max(Math.min(next, range.max), lo));
  }

  const leftPct = ((lo - range.min) / span) * 100;
  const rightPct = ((hi - range.min) / span) * 100;

  return (
    <div
      className="col-filter col-filter-range"
      title={`${formatRangeBound(id, lo)} → ${formatRangeBound(id, hi)}`}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="dual-range">
        <div
          className="dual-range-track"
          style={{
            left: `${leftPct}%`,
            width: `${Math.max(0, rightPct - leftPct)}%`,
          }}
        />
        <input
          type="range"
          min={range.min}
          max={range.max}
          step={id === "durationMs" ? 1000 : 1}
          value={lo}
          onChange={(e) => setLo(Number(e.target.value))}
          aria-label="From"
        />
        <input
          type="range"
          min={range.min}
          max={range.max}
          step={id === "durationMs" ? 1000 : 1}
          value={hi}
          onChange={(e) => setHi(Number(e.target.value))}
          aria-label="To"
        />
      </div>
      <div className="dual-range-labels">
        <span>{formatRangeBound(id, lo)}</span>
        <span>{formatRangeBound(id, hi)}</span>
      </div>
    </div>
  );
}
