import type { AppSettings, PatternEntry } from "../lib/types";
import { SORT_FIELDS } from "../lib/types";
import { PatternList } from "./PatternList";

type Props = {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
  onIncludeChange: (entries: PatternEntry[]) => void;
  onIgnoreChange: (entries: PatternEntry[]) => void;
  onApply: () => void;
  onToggleSettings: () => void;
  onCollapse: () => void;
  settingsOpen: boolean;
  applying: boolean;
};

export function FileFilterPane({
  settings,
  onChange,
  onIncludeChange,
  onIgnoreChange,
  onApply,
  onToggleSettings,
  onCollapse,
  settingsOpen,
  applying,
}: Props) {
  return (
    <aside className="pane pane-left">
      <div className="pane-header pane-header-row">
        <div>
          <h1>File Filter</h1>
          <p className="subtitle">Include &amp; ignore</p>
        </div>
        <button
          type="button"
          className="btn-ghost"
          title="Hide filters"
          onClick={onCollapse}
        >
          ◀
        </button>
      </div>
      <div className="pane-scroll">
        <button
          type="button"
          className={`btn ${settingsOpen ? "btn-primary" : ""}`}
          style={{ width: "100%", marginBottom: 12 }}
          onClick={onToggleSettings}
        >
          {settingsOpen ? "Back to results" : "Settings"}
        </button>
        <PatternList
          title="Include patterns"
          hint="OR on full path — empty = all. Use + for AND (any order)."
          entries={settings.includeRegexes}
          onChange={onIncludeChange}
          defaultOpen
        />
        <PatternList
          title="Ignore patterns"
          hint="OR on full path — wins over include. Use + for AND (any order)."
          entries={settings.ignoreRegexes}
          onChange={onIgnoreChange}
          defaultOpen
        />

        <div className="section">
          <div className="section-body" style={{ paddingTop: 10 }}>
            <strong style={{ display: "block", marginBottom: 8 }}>Sort</strong>
            <div className="field-row">
              <select
                value={settings.sortField}
                onChange={(e) => onChange({ ...settings, sortField: e.target.value })}
                style={{ flex: 1 }}
              >
                {SORT_FIELDS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
              <select
                value={settings.sortDir}
                disabled={settings.sortField === "random"}
                onChange={(e) =>
                  onChange({
                    ...settings,
                    sortDir: e.target.value === "desc" ? "desc" : "asc",
                  })
                }
              >
                <option value="asc">Asc</option>
                <option value="desc">Desc</option>
              </select>
            </div>
            <label className="inline" style={{ marginTop: 6, display: "flex" }}>
              <input
                type="checkbox"
                checked={settings.splitBySearch}
                onChange={(e) =>
                  onChange({ ...settings, splitBySearch: e.target.checked })
                }
              />
              Split by search
            </label>
          </div>
        </div>

        <button
          type="button"
          className="btn btn-primary"
          style={{ width: "100%", marginTop: 4 }}
          onClick={onApply}
          disabled={applying}
        >
          {applying ? "Applying…" : "Apply filter"}
        </button>
      </div>
    </aside>
  );
}
