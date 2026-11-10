import { useState } from "react";
import type { PatternEntry } from "../lib/types";
import { validatePattern } from "../lib/patterns";

type Props = {
  title: string;
  entries: PatternEntry[];
  onChange: (entries: PatternEntry[]) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Render body only (no collapsible header) — used inside Settings. */
  alwaysExpanded?: boolean;
};

export function PatternList({
  title,
  entries,
  onChange,
  open,
  onOpenChange,
  alwaysExpanded = false,
}: Props) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  function updateAt(index: number, patch: Partial<PatternEntry>) {
    onChange(entries.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  }

  function removeAt(index: number) {
    onChange(entries.filter((_, i) => i !== index));
  }

  function moveEntry(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= entries.length || to >= entries.length) {
      return;
    }
    const next = [...entries];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    onChange(next);
  }

  function add() {
    const pattern = draft.trim();
    if (!pattern) return;
    const err = validatePattern(pattern);
    if (err) {
      setError("Invalid pattern");
      return;
    }
    if (entries.some((e) => e.pattern === pattern)) {
      setError("Already in list");
      return;
    }
    setError(null);
    setDraft("");
    onChange([...entries, { pattern, enabled: true }]);
  }

  const body = (
    <>
      <div className="pattern-list-scroll">
        {entries.length === 0 && <div className="empty-note">None yet</div>}
        {entries.map((entry, index) => (
          <div
            key={`${entry.pattern}-${index}`}
            className={`pattern-entry ${entry.enabled ? "" : "disabled"} ${
              dragIndex === index ? "dragging" : ""
            }`}
            draggable
            onDragStart={() => setDragIndex(index)}
            onDragOver={(e) => {
              e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex != null) moveEntry(dragIndex, index);
              setDragIndex(null);
            }}
            onDragEnd={() => setDragIndex(null)}
          >
            <div className="field-row">
              <span className="drag-handle" title="Drag to reorder">
                ⋮⋮
              </span>
              <input
                type="checkbox"
                checked={entry.enabled}
                onChange={(e) =>
                  updateAt(index, { enabled: e.target.checked })
                }
                title="Enable pattern"
              />
              <input
                type="text"
                className="mono"
                value={entry.pattern}
                onChange={(e) =>
                  updateAt(index, { pattern: e.target.value })
                }
              />
              <button
                type="button"
                className="btn-danger"
                onClick={() => removeAt(index)}
                title="Remove"
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="field-row pattern-list-add">
        <input
          type="text"
          className="mono"
          placeholder="Add pattern…"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
        />
        <button type="button" className="btn" onClick={add}>
          Add
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
    </>
  );

  if (alwaysExpanded) {
    return <div className="pattern-list-embedded">{body}</div>;
  }

  return (
    <div className="section">
      <button
        type="button"
        className="section-toggle"
        onClick={() => onOpenChange(!open)}
      >
        <span className="chevron">{open ? "▼" : "▶"}</span>
        <strong>{title}</strong>
      </button>
      {open && <div className="section-body">{body}</div>}
    </div>
  );
}
