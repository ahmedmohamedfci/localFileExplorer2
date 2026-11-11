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

function toDateInputValue(secs: number): string {
  if (!Number.isFinite(secs)) return "";
  const d = new Date(secs * 1000);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fromDateInputValue(value: string): number | null {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor(d.getTime() / 1000);
}

function durationToSeconds(ms: number): number {
  return Math.floor(ms / 1000);
}

function secondsToDurationMs(secs: number): number {
  return secs * 1000;
}

/** Min/max inputs for duration / date columns (no fragile dual-thumb slider). */
export function ColumnRangeFilter({
  id,
  extent,
  min,
  max,
  onChange,
}: Props) {
  if (!extent || !Number.isFinite(extent.min) || !Number.isFinite(extent.max)) {
    return (
      <div className="col-filter col-filter-range is-empty" title="No range">
        —
      </div>
    );
  }

  const range = extent;
  const isDuration = id === "durationMs";

  function commit(nextMin: number | null, nextMax: number | null) {
    const lo = nextMin == null ? null : Math.max(range.min, nextMin);
    const hi = nextMax == null ? null : Math.min(range.max, nextMax);
    const clearedMin = lo == null || lo <= range.min ? null : lo;
    const clearedMax = hi == null || hi >= range.max ? null : hi;
    onChange(clearedMin, clearedMax);
  }

  if (isDuration) {
    const loSec =
      min != null ? durationToSeconds(min) : durationToSeconds(range.min);
    const hiSec =
      max != null ? durationToSeconds(max) : durationToSeconds(range.max);
    return (
      <div
        className="col-filter col-filter-range col-filter-inputs"
        title={`${formatRangeBound(id, min ?? range.min)} → ${formatRangeBound(id, max ?? range.max)}`}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          type="number"
          className="col-filter-bound mono"
          min={durationToSeconds(range.min)}
          max={durationToSeconds(range.max)}
          step={1}
          value={loSec}
          aria-label="Min duration (seconds)"
          title="Min seconds"
          onChange={(e) => {
            const v = Number(e.target.value);
            if (!Number.isFinite(v)) return;
            commit(secondsToDurationMs(v), max);
          }}
        />
        <span className="col-filter-sep">–</span>
        <input
          type="number"
          className="col-filter-bound mono"
          min={durationToSeconds(range.min)}
          max={durationToSeconds(range.max)}
          step={1}
          value={hiSec}
          aria-label="Max duration (seconds)"
          title="Max seconds"
          onChange={(e) => {
            const v = Number(e.target.value);
            if (!Number.isFinite(v)) return;
            commit(min, secondsToDurationMs(v));
          }}
        />
      </div>
    );
  }

  return (
    <div
      className="col-filter col-filter-range col-filter-inputs"
      title={`${formatRangeBound(id, min ?? range.min)} → ${formatRangeBound(id, max ?? range.max)}`}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <input
        type="date"
        className="col-filter-bound"
        value={toDateInputValue(min ?? range.min)}
        min={toDateInputValue(range.min)}
        max={toDateInputValue(range.max)}
        aria-label="From date"
        onChange={(e) => {
          const v = fromDateInputValue(e.target.value);
          commit(v, max);
        }}
      />
      <input
        type="date"
        className="col-filter-bound"
        value={toDateInputValue(max ?? range.max)}
        min={toDateInputValue(range.min)}
        max={toDateInputValue(range.max)}
        aria-label="To date"
        onChange={(e) => {
          const raw = fromDateInputValue(e.target.value);
          // Inclusive end-of-day for the chosen date.
          const v = raw == null ? null : raw + 24 * 60 * 60 - 1;
          commit(min, v);
        }}
      />
    </div>
  );
}
