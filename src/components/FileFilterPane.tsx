import {
  clampNumFiles,
  type AppSettings,
  type PatternEntry,
  type UiLayout,
} from "../lib/types";
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
  onUiChange: (patch: Partial<UiLayout>) => void;
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
  onUiChange,
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
      <div className="filter-actions">
        <button
          type="button"
          className="btn btn-primary"
          style={{ flex: 1 }}
          onClick={onApply}
          disabled={applying}
        >
          {applying ? "Applying…" : "Apply filter"}
        </button>
        <button
          type="button"
          className={`btn ${settingsOpen ? "btn-primary" : ""}`}
          style={{ flex: 1 }}
          onClick={onToggleSettings}
        >
          {settingsOpen ? "Back to results" : "Settings"}
        </button>
      </div>

      <div className="sort-under-actions">
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
        <div className="sort-checks">
          <label className="inline">
            <input
              type="checkbox"
              checked={settings.discardPath}
              onChange={(e) =>
                onChange({ ...settings, discardPath: e.target.checked })
              }
              title="When on: sort by file name so same names group across folders (also with Random). When off: group by parent folder, then by name within each folder."
            />
            Discard path
          </label>
          <label className="inline">
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
        <label className="inline num-files-field" htmlFor="num-files">
          Num of files
          <input
            id="num-files"
            type="number"
            min={0}
            step={1}
            value={settings.numFiles}
            title="0 = no limit. With Split by search, this many files in each section. Otherwise, this many files in the whole playlist."
            onChange={(e) =>
              onChange({
                ...settings,
                numFiles: clampNumFiles(e.target.value),
              })
            }
          />
        </label>
      </div>

      <div className="pane-scroll">
        <PatternList
          title="Include patterns"
          hint="OR on full path — empty = all. Use + for AND; !term to exclude (e.g. abc+ght+!xyz)."
          entries={settings.includeRegexes}
          onChange={onIncludeChange}
          open={settings.ui.includePatternsOpen}
          onOpenChange={(open) => onUiChange({ includePatternsOpen: open })}
        />
        <PatternList
          title="Ignore patterns"
          hint="OR on full path — wins over include. Use + for AND; !term to exclude."
          entries={settings.ignoreRegexes}
          onChange={onIgnoreChange}
          open={settings.ui.ignorePatternsOpen}
          onOpenChange={(open) => onUiChange({ ignorePatternsOpen: open })}
        />
      </div>
    </aside>
  );
}
