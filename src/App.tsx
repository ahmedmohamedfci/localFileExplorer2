import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { SettingsPanel } from "./components/ControlsPane";
import { FileFilterPane } from "./components/FileFilterPane";
import { ResultsTable, type TableSortField } from "./components/ResultsTable";
import { sortFileRecords } from "./lib/sort";
import * as api from "./lib/api";
import { compilePatternList, compileUserPattern, validatePattern } from "./lib/patterns";
import { truncateMiddle } from "./lib/format";
import { buildDisplayRows, enabledPatterns, rowsToPlaylistItems } from "./lib/results";
import {
  defaultSettings,
  type AppSettings,
  type FileRecord,
  type PatternEntry,
  type ResultRow,
  type ScanProgress,
} from "./lib/types";

const idleProgress: ScanProgress = {
  phase: "idle",
  message: "",
  scanned: 0,
  skipped: 0,
  files: 0,
  currentFolder: "",
};

export default function App() {
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings());
  const [dataDir, setDataDir] = useState("");
  const [catalogCount, setCatalogCount] = useState(0);
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [hasApplied, setHasApplied] = useState(false);
  const [applying, setApplying] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState(false);
  const [testPattern, setTestPattern] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<ScanProgress>(idleProgress);
  const [scanning, setScanning] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const init = await api.initApp();
        setSettings(init.settings);
        setDataDir(init.dataDir);
        setCatalogCount(init.catalogCount);
        setProgress((p) => ({ ...p, files: init.catalogCount }));
        setReady(true);
        unlisten = await listen<ScanProgress>("scan-progress", (event) => {
          const next = event.payload;
          setProgress(next);
          setScanning(next.phase === "scanning");
          if (next.phase === "done") {
            setCatalogCount(next.files);
            setStatusMessage("Scan complete");
          } else if (next.phase === "error") {
            setStatusMessage(next.message);
          } else if (next.message === "Scan cancelled") {
            setStatusMessage("Scan cancelled");
            setScanning(false);
          }
        });
      } catch (e) {
        setBootError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      unlisten?.();
    };
  }, []);

  const { rows, displayedFileCount, testError } = useMemo(
    () =>
      buildDisplayRows({
        files,
        includePatterns: settings.includeRegexes,
        splitBySearch: settings.splitBySearch,
        testPattern,
        collapsedGroups,
      }),
    [files, settings.includeRegexes, settings.splitBySearch, testPattern, collapsedGroups],
  );

  const selectedRow = rows.find((r) => r.id === selectedId) ?? null;

  async function applyFilter(nextSettings = settings) {
    setApplying(true);
    setLoadingLabel(true);
    setQueryError(null);
    try {
      const include = enabledPatterns(nextSettings.includeRegexes);
      const ignore = enabledPatterns(nextSettings.ignoreRegexes);
      const compiledInclude = compilePatternList(include);
      if (!compiledInclude.ok) {
        setQueryError(compiledInclude.error);
        return;
      }
      const compiledIgnore = compilePatternList(ignore);
      if (!compiledIgnore.ok) {
        setQueryError(compiledIgnore.error);
        return;
      }

      const saved = await api.saveSettings(nextSettings);
      setSettings(saved);
      const result = await api.queryFiles({
        includeClauses: compiledInclude.clauses,
        ignoreClauses: compiledIgnore.clauses,
        sortField: saved.sortField,
        sortDir: saved.sortDir,
      });
      setFiles(result);
      setHasApplied(true);
      setSelectedId(null);
      setCatalogCount(await api.getCatalogCount());
      setStatusMessage("Settings saved");
      setSettingsOpen(false);
    } catch (e) {
      setQueryError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
      setLoadingLabel(false);
    }
  }

  async function saveAndScan() {
    try {
      const saved = await api.saveSettings(settings);
      setSettings(saved);
      setStatusMessage("Settings saved");
      setScanning(true);
      await api.startScan(saved);
    } catch (e) {
      setScanning(false);
      setStatusMessage(e instanceof Error ? e.message : String(e));
    }
  }

  async function addRoot() {
    const folder = await api.pickFolder();
    if (!folder) return;
    if (settings.roots.includes(folder)) return;
    setSettings({ ...settings, roots: [...settings.roots, folder] });
  }

  async function browseDatabase() {
    const path = await api.pickDatabasePath();
    if (!path) return;
    setSettings({ ...settings, databasePath: path });
  }

  async function saveSettingsOnly() {
    try {
      const saved = await api.saveSettings(settings);
      setSettings(saved);
      setCatalogCount(await api.getCatalogCount());
      setStatusMessage("Settings saved");
    } catch (e) {
      setStatusMessage(e instanceof Error ? e.message : String(e));
    }
  }

  async function exportSettings() {
    try {
      const path = await api.exportSettings(settings);
      if (path) setStatusMessage(`Settings exported to ${path}`);
    } catch (e) {
      setStatusMessage(e instanceof Error ? e.message : String(e));
    }
  }

  async function importSettings() {
    try {
      const imported = await api.importSettings();
      if (!imported) return;
      setSettings(imported.settings);
      setDataDir(imported.dataDir);
      setCatalogCount(imported.catalogCount);
      setFiles([]);
      setHasApplied(false);
      setSelectedId(null);
      setStatusMessage("Settings imported");
    } catch (e) {
      setStatusMessage(e instanceof Error ? e.message : String(e));
    }
  }

  async function openSelectedPlaylist() {
    const items = rowsToPlaylistItems(rows);
    if (items.length === 0) return;
    try {
      await api.openPlaylist(items);
      setStatusMessage("Opened MPC playlist");
    } catch (e) {
      setStatusMessage(e instanceof Error ? e.message : String(e));
    }
  }

  function addTestTo(list: "include" | "ignore") {
    const pattern = testPattern.trim();
    if (!pattern || validatePattern(pattern)) return;
    const key = list === "include" ? "includeRegexes" : "ignoreRegexes";
    if (settings[key].some((e) => e.pattern === pattern)) return;
    const entry: PatternEntry = { pattern, enabled: true };
    setSettings({ ...settings, [key]: [...settings[key], entry] });
  }

  function emptyMessage(): string {
    if (!hasApplied) {
      return "No files match. Add roots and run a scan, or loosen filters.";
    }
    if (testPattern.trim() && testError) {
      return testError;
    }
    if (testPattern.trim()) {
      return "No files match this test regex.";
    }
    return "No files match. Add roots and run a scan, or loosen filters.";
  }

  function onTableSort(field: TableSortField) {
    const same = settings.sortField === field;
    const nextDir =
      same && settings.sortDir === "asc" ? ("desc" as const) : ("asc" as const);
    const next = { ...settings, sortField: field, sortDir: nextDir };
    setSettings(next);
    if (hasApplied) {
      setFiles((prev) => sortFileRecords(prev, field, nextDir));
      void api.saveSettings(next);
    }
  }

  if (bootError) {
    return <div className="boot">Failed to start: {bootError}</div>;
  }
  if (!ready) {
    return <div className="boot">Starting…</div>;
  }

  const countLabel = loadingLabel
    ? "loading…"
    : `${displayedFileCount} / ${catalogCount}`;

  const testInvalid = Boolean(
    testPattern.trim() && compileUserPattern(testPattern.trim()).ok === false,
  );

  return (
    <div className="app-shell">
      <FileFilterPane
        settings={settings}
        applying={applying}
        onChange={setSettings}
        onIncludeChange={(includeRegexes) => setSettings({ ...settings, includeRegexes })}
        onIgnoreChange={(ignoreRegexes) => setSettings({ ...settings, ignoreRegexes })}
        onApply={() => applyFilter()}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <div className="pane pane-right">
        {settingsOpen ? (
          <SettingsPanel
            settings={settings}
            dataDir={dataDir}
            onChange={setSettings}
            onClose={() => setSettingsOpen(false)}
            onSaveAndScan={saveAndScan}
            onCancelScan={() => void api.cancelScan()}
            onAddRoot={() => void addRoot()}
            onBrowseDatabase={() => void browseDatabase()}
            onExportSettings={() => void exportSettings()}
            onImportSettings={() => void importSettings()}
            onSaveSettings={() => void saveSettingsOnly()}
            scanning={scanning}
            progress={progress}
            statusMessage={statusMessage}
          />
        ) : (
          <section className="main-stage">
            <div className="results-header">
              <div>
                <h1 style={{ margin: 0, fontSize: 15 }}>Results</h1>
                <div className="count">{countLabel}</div>
                {queryError && <p className="error-text">{queryError}</p>}
              </div>
              <button
                type="button"
                className="btn btn-primary"
                disabled={rowsToPlaylistItems(rows).length === 0}
                title={
                  rowsToPlaylistItems(rows).length === 0
                    ? "Results list is empty"
                    : "Open playlist in MPC"
                }
                onClick={openSelectedPlaylist}
              >
                Open
              </button>
            </div>

            {selectedRow && (
              <div className="selection-line" title={selectionPath(selectedRow)}>
                Selected: <strong>#{selectionIndex(selectedRow)}</strong>{" "}
                {truncateMiddle(selectionPath(selectedRow), 100)}
              </div>
            )}

            <div className="results-hint">
              Double-click or Enter opens a file. # matches MPC playlist order.
            </div>

            <div className="test-bar">
              <label htmlFor="test-pattern">
                Test pattern (full path) — use + for AND (any order)
              </label>
              <input
                id="test-pattern"
                className="text grow mono"
                placeholder="moh+mon+aha"
                value={testPattern}
                onChange={(e) => setTestPattern(e.target.value)}
              />
              {testPattern && (
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setTestPattern("")}
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                className="btn"
                disabled={!testPattern.trim() || testInvalid}
                onClick={() => addTestTo("include")}
              >
                + Include
              </button>
              <button
                type="button"
                className="btn"
                disabled={!testPattern.trim() || testInvalid}
                onClick={() => addTestTo("ignore")}
              >
                + Ignore
              </button>
              {testError && (
                <p className="error-text" style={{ width: "100%" }}>
                  {testError}
                </p>
              )}
            </div>

            <ResultsTable
              rows={rows}
              selectedId={selectedId}
              sortField={settings.sortField}
              sortDir={settings.sortDir}
              emptyMessage={emptyMessage()}
              onSort={onTableSort}
              onSelect={(row) => setSelectedId(row.id)}
              onOpenFile={(path) => {
                void api.openFile(path);
              }}
              onToggleGroup={(groupKey) => {
                setCollapsedGroups((prev) => {
                  const next = new Set(prev);
                  if (next.has(groupKey)) next.delete(groupKey);
                  else next.add(groupKey);
                  return next;
                });
              }}
            />
          </section>
        )}
      </div>
    </div>
  );
}

function selectionPath(row: ResultRow): string {
  if (row.kind === "file") return row.file.path;
  if (row.kind === "delimiter") return row.label;
  return row.label;
}

function selectionIndex(row: ResultRow): string {
  if (row.kind === "section") return "—";
  return String(row.playlistIndex);
}
