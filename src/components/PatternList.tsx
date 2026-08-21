import { useState } from "react";
import type { PatternEntry } from "../lib/types";
import { validatePattern } from "../lib/patterns";

type Props = {
  title: string;
  hint: string;
  entries: PatternEntry[];
  onChange: (entries: PatternEntry[]) => void;
  defaultOpen?: boolean;
};

export function PatternList({
  title,
  hint,
  entries,
  onChange,
  defaultOpen = true,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  function updateAt(index: number, patch: Partial<PatternEntry>) {
    onChange(entries.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  }

  function removeAt(index: number) {
    onChange(entries.filter((_, i) => i !== index));
  }

  function add() {
    const pattern = draft.trim();
    if (!pattern) return;
    const err = validatePattern(pattern);
    if (err) {
      setError("Invalid regex");
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

  return (
    <div className="section">
      <button type="button" className="section-toggle" onClick={() => setOpen((v) => !v)}>
        <span className="chevron">{open ? "▼" : "▶"}</span>
        <strong>{title}</strong>
      </button>
      {open && (
        <div className="section-body">
          <p className="hint">{hint}</p>
          {entries.length === 0 && <div className="empty-note">None yet</div>}
          {entries.map((entry, index) => (
            <div
              key={`${entry.pattern}-${index}`}
              className={`field-row ${entry.enabled ? "" : "disabled"}`}
            >
              <input
                type="checkbox"
                checked={entry.enabled}
                onChange={(e) => updateAt(index, { enabled: e.target.checked })}
                title="Enable pattern"
              />
              <input
                type="text"
                className="mono"
                value={entry.pattern}
                onChange={(e) => updateAt(index, { pattern: e.target.value })}
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
          ))}
          <div className="field-row">
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
        </div>
      )}
    </div>
  );
}
