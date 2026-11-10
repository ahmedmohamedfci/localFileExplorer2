import { useState } from "react";
import {
  TABLE_COLUMN_META,
  type TableColumnConfig,
  type TableColumnId,
} from "../lib/tableColumns";

type Props = {
  columns: TableColumnConfig[];
  onChange: (columns: TableColumnConfig[]) => void;
};

/** Drag-reorder + show/hide for result table columns (tabs). */
export function ColumnOrderList({ columns, onChange }: Props) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  function toggleVisible(id: TableColumnId) {
    const next = columns.map((c) =>
      c.id === id ? { ...c, visible: !c.visible } : c,
    );
    if (!next.some((c) => c.visible)) return;
    onChange(next);
  }

  function moveColumn(from: number, to: number) {
    if (
      from === to ||
      from < 0 ||
      to < 0 ||
      from >= columns.length ||
      to >= columns.length
    ) {
      return;
    }
    const next = [...columns];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    onChange(next);
  }

  return (
    <div className="column-order-list">
      <p className="hint">
        Drag to reorder columns (important fields first). Uncheck to hide.
      </p>
      {columns.map((col, index) => (
        <label
          key={col.id}
          className={`inline column-picker-item ${
            dragIndex === index ? "dragging" : ""
          }`}
          draggable
          onDragStart={() => setDragIndex(index)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (dragIndex != null) moveColumn(dragIndex, index);
            setDragIndex(null);
          }}
          onDragEnd={() => setDragIndex(null)}
        >
          <span className="drag-handle" title="Drag to reorder">
            ⋮⋮
          </span>
          <input
            type="checkbox"
            checked={col.visible}
            onChange={() => toggleVisible(col.id)}
          />
          {TABLE_COLUMN_META[col.id].label}
        </label>
      ))}
    </div>
  );
}
