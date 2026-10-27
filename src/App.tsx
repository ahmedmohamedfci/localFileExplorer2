import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { BrowserSettingsGate } from "./components/BrowserSettingsGate";
import { SettingsPanel } from "./components/ControlsPane";
import { FileFilterPane } from "./components/FileFilterPane";
import { ResultsTable, type TableSortField } from "./components/ResultsTable";
import { sortFileRecords } from "./lib/sort";
import * as api from "./lib/api";
import { compilePatternList, compileUserPattern, validatePattern } from "./lib/patterns";
import { truncateMiddle } from "./lib/format";
import {
  buildDisplayRows,
  enabledPatterns,
  playlistFilePaths,
  rowsToPlaylistItems,
} from "./lib/results";
import { isBrowserHost, isTauri } from "./lib/runtime";
import {
  defaultSettings,
  hydrateSettings,
  type AppSettings,
  type FileRecord,
  type PatternEntry,
  type ResultRow,
  type MoveFilesResult,
  type ScanProgress,
  type UiLayout,
} from "./lib/types";
import { type TableColumnConfig } from "./lib/tableColumns";
import { readSettingsFromHash } from "./lib/urlSettings";
import { syncWindowTitle } from "./lib/windowTitle";

function formatMoveStatus(result: MoveFilesResult): string {
  const dest = result.destination;
  if (result.moved === 0 && result.failed.length > 0) {
    return `Could not move files. ${result.failed.slice(0, 2).join("; ")}`;
  }
  if (result.moved === 0 && result.skipped > 0) {
    return result.skipped === 1
      ? `That file is already in ${dest}`
      : `All ${result.skipped} files are already in ${dest}`;
  }
  const noun = result.moved === 1 ? "file" : "files";
  let msg = `Moved ${result.moved} ${noun} to ${dest}`;
  if (result.skipped > 0) msg += ` (${result.skipped} already there)`;
  if (result.failed.length > 0) {
    const extra =
      result.failed.length > 2 ? ` (+${result.failed.length - 2} more)` : "";
    msg += `. ${result.failed.length} failed: ${result.failed.slice(0, 2).join("; ")}${extra}`;
  }
  return msg;
}

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
  const [showBrowserGate, setShowBrowserGate] = useState(false);
  const [gateUrlError, setGateUrlError] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings());
  const [dataDir, setDataDir] = useState("");
  const [catalogCount, setCatalogCount] = useState(0);
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [hasApplied, setHasApplied] = useState(false);
  const [applying, setApplying] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState(false);
  const [testPattern, setTestPattern] = useState("");
  /** When true, test pattern searches the catalog without include/ignore filters. */
  const [testGlobalSearch, setTestGlobalSearch] = useState(false);
  const [globalSearchFiles, setGlobalSearchFiles] = useState<FileRecord[] | null>(
    null,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<ScanProgress>(idleProgress);
  const [scanning, setScanning] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const bulkRef = useRef<HTMLDivElement>(null);
  const [hostUrl, setHostUrl] = useState<string | null>(null);

  const leftPaneOpen = settings.ui.leftPaneOpen;
  const settingsOpen = settings.ui.settingsOpen;

  useEffect(() => {
    if (!bulkOpen) return;
    function onDoc(e: MouseEvent) {
      if (!bulkRef.current?.contains(e.target as Node)) setBulkOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setBulkOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [bulkOpen]);

  function patchUi(patch: Partial<UiLayout>) {
    setSettings((prev) => {
      const next = { ...prev, ui: { ...prev.ui, ...patch } };
      void api.saveSettings(next);
      return next;
    });
  }

  async function bootBrowserSession(next: AppSettings) {
    try {
      const init = isBrowserHost()
        ? await api.initBrowserSession(next)
        : null;
      if (init) {
        setSettings(hydrateSettings(init.settings));
        setDataDir(init.dataDir);
        setCatalogCount(init.catalogCount);
        setProgress((p) => ({ ...p, files: init.catalogCount }));
        syncWindowTitle(init.settings.contextName);
      } else {
        enterWithSettings(next, "(browser — URL settings)");
        return;
      }
      setShowBrowserGate(false);
      setGateUrlError(null);
      setBootError(null);
      setReady(true);
    } catch (e) {
      setBootError(e instanceof Error ? e.message : String(e));
    }
  }

  function enterWithSettings(next: AppSettings, dirLabel: string) {
    const hydrated = hydrateSettings(next);
    setSettings(hydrated);
    setDataDir(dirLabel);
    setCatalogCount(0);
    setProgress((p) => ({ ...p, files: 0 }));
    syncWindowTitle(hydrated.contextName);
    setShowBrowserGate(false);
    setGateUrlError(null);
    setBootError(null);
    setReady(true);
  }

  useEffect(() => {
    if (!ready) return;
    syncWindowTitle(settings.contextName);
  }, [ready, settings.contextName]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    syncWindowTitle(null);

    if (!isTauri()) {
      const fromUrl = readSettingsFromHash();
      if (fromUrl == null) {
        setShowBrowserGate(true);
        return;
      }
      if (!fromUrl.ok) {
        setGateUrlError(fromUrl.error);
        setShowBrowserGate(true);
        return;
      }
      void bootBrowserSession(fromUrl.settings);
      return;
    }

    (async () => {
      try {
        const init = await api.initApp();
        setSettings(hydrateSettings(init.settings));
        setDataDir(init.dataDir);
        setCatalogCount(init.catalogCount);
        setProgress((p) => ({ ...p, files: init.catalogCount }));
        syncWindowTitle(init.settings.contextName);
        setHostUrl(await api.getHostUrl());
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

  useEffect(() => {
    if (!ready || isTauri() || !isBrowserHost()) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await api.getScanProgress();
        if (cancelled) return;
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
      } catch {
        /* host may be restarting */
      }
    };
    const id = window.setInterval(tick, 500);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [ready]);

  useEffect(() => {
    if (!testGlobalSearch || !hasApplied) {
      setGlobalSearchFiles(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const result = await api.queryFiles({
          includeClauses: [],
          ignoreClauses: [],
          sortField: settings.sortField,
          sortDir: settings.sortDir,
          discardPath: settings.discardPath,
        });
        if (!cancelled) setGlobalSearchFiles(result);
      } catch {
        if (!cancelled) setGlobalSearchFiles(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    testGlobalSearch,
    hasApplied,
    catalogCount,
    settings.sortField,
    settings.sortDir,
    settings.discardPath,
  ]);

  const filesForDisplay =
    testGlobalSearch && testPattern.trim()
      ? (globalSearchFiles ?? [])
      : files;

  const { rows, displayedFileCount, testError } = useMemo(
    () =>
      buildDisplayRows({
        files: filesForDisplay,
        includePatterns: settings.includeRegexes,
        splitBySearch: settings.splitBySearch,
        numFiles: settings.numFiles,
        testPattern,
        collapsedGroups,
      }),
    [
      filesForDisplay,
      settings.includeRegexes,
      settings.splitBySearch,
      settings.numFiles,
      testPattern,
      collapsedGroups,
    ],
  );

  function updateSettings(next: AppSettings) {
    const discardChanged = next.discardPath !== settings.discardPath;
    const sortMetaChanged =
      next.sortField !== settings.sortField || next.sortDir !== settings.sortDir;
    setSettings(next);
    // Re-sort loaded results when discard path toggles, or when a non-random
    // sort field/dir changes. Switching to Random still needs Apply to reshuffle.
    if (
      hasApplied &&
      (discardChanged || (sortMetaChanged && next.sortField !== "random"))
    ) {
      setFiles((prev) =>
        sortFileRecords(prev, next.sortField, next.sortDir, next.discardPath),
      );
    }
  }

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

      const toSave = {
        ...nextSettings,
        ui: { ...nextSettings.ui, settingsOpen: false },
      };
      const saved = await api.saveSettings(toSave);
      setSettings(hydrateSettings(saved));
      const result = await api.queryFiles({
        includeClauses: compiledInclude.clauses,
        ignoreClauses: compiledIgnore.clauses,
        sortField: saved.sortField,
        sortDir: saved.sortDir,
        discardPath: saved.discardPath,
      });
      setFiles(result);
      setHasApplied(true);
      setSelectedId(null);
      setCatalogCount(await api.getCatalogCount());
      setStatusMessage("Settings saved");
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
      setSettings(hydrateSettings(saved));
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
      setSettings(hydrateSettings(saved));
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
      setSettings(hydrateSettings(imported.settings));
      setDataDir(imported.dataDir);
      setCatalogCount(imported.catalogCount);
      syncWindowTitle(imported.settings.contextName);
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
    if (items.length === 0 || moving) return;
    try {
      await api.openPlaylist(items);
      setStatusMessage("Opened MPC playlist");
    } catch (e) {
      setStatusMessage(e instanceof Error ? e.message : String(e));
    }
  }

  async function movePlaylistFiles() {
    const paths = playlistFilePaths(rows);
    if (paths.length === 0 || moving) return;
    setBulkOpen(false);
    try {
      const destination = await api.pickFolder("Move playlist files to");
      if (!destination) return;
      setMoving(true);
      setStatusMessage(`Moving ${paths.length} files…`);
      const result = await api.moveFiles(paths, destination);
      if (result.renames.length > 0) {
        const map = new Map(result.renames.map((r) => [r.from, r.to]));
        const remap = (list: FileRecord[]) =>
          list.map((file) => {
            const to = map.get(file.path);
            return to ? { ...file, path: to } : file;
          });
        setFiles((prev) => remap(prev));
        setGlobalSearchFiles((prev) => (prev ? remap(prev) : prev));
      }
      setStatusMessage(formatMoveStatus(result));
    } catch (e) {
      setStatusMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setMoving(false);
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
      setFiles((prev) =>
        sortFileRecords(prev, field, nextDir, next.discardPath),
      );
      void api.saveSettings(next);
    }
  }

  function onTableColumnsChange(columns: TableColumnConfig[]) {
    const next = { ...settings, tableColumns: columns };
    setSettings(next);
    void api.saveSettings(next);
  }

  if (showBrowserGate) {
    return (
      <BrowserSettingsGate
        urlError={gateUrlError}
        onReady={(next) => {
          if (isBrowserHost()) void bootBrowserSession(next);
          else enterWithSettings(next, "(browser — URL settings)");
        }}
        onUseNativeDefault={
          isBrowserHost()
            ? async () => {
                try {
                  const init = await api.initBrowserSessionDefault();
                  setSettings(hydrateSettings(init.settings));
                  setDataDir(init.dataDir);
                  setCatalogCount(init.catalogCount);
                  setProgress((p) => ({ ...p, files: init.catalogCount }));
                  syncWindowTitle(init.settings.contextName);
                  setShowBrowserGate(false);
                  setGateUrlError(null);
                  setBootError(null);
                  setReady(true);
                } catch (e) {
                  setGateUrlError(
                    e instanceof Error ? e.message : String(e),
                  );
                }
              }
            : undefined
        }
      />
    );
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
  const playlistItems = rowsToPlaylistItems(rows);
  const playlistPaths = playlistFilePaths(rows);

  return (
    <div className={`app-shell ${leftPaneOpen ? "" : "left-collapsed"}`}>
      {leftPaneOpen ? (
        <FileFilterPane
          settings={settings}
          applying={applying}
          settingsOpen={settingsOpen}
          onChange={updateSettings}
          onIncludeChange={(includeRegexes) =>
            setSettings({ ...settings, includeRegexes })
          }
          onIgnoreChange={(ignoreRegexes) =>
            setSettings({ ...settings, ignoreRegexes })
          }
          onApply={() => applyFilter()}
          onToggleSettings={() => patchUi({ settingsOpen: !settingsOpen })}
          onCollapse={() => patchUi({ leftPaneOpen: false })}
          onUiChange={patchUi}
        />
      ) : (
        <button
          type="button"
          className="left-expand-tab"
          title="Show filters"
          onClick={() => patchUi({ leftPaneOpen: true })}
        >
          ▶
        </button>
      )}

      <div className="pane pane-right">
        {settingsOpen ? (
          <SettingsPanel
            settings={settings}
            dataDir={dataDir}
            onChange={setSettings}
            onUiChange={patchUi}
            onClose={() => patchUi({ settingsOpen: false })}
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
            hostUrl={hostUrl}
          />
        ) : (
          <section className="main-stage">
            <div className="results-header">
              <div>
                <h1 style={{ margin: 0, fontSize: 15 }}>Results</h1>
                <div className="count">{countLabel}</div>
                {queryError && <p className="error-text">{queryError}</p>}
                {statusMessage && <p className="status-text">{statusMessage}</p>}
              </div>
              <div className="results-header-actions">
                {!leftPaneOpen && (
                  <>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => patchUi({ leftPaneOpen: true })}
                      title="Show filters"
                    >
                      Filters
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => patchUi({ settingsOpen: true })}
                    >
                      Settings
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={playlistItems.length === 0 || moving}
                  title={
                    playlistItems.length === 0
                      ? "Results list is empty"
                      : "Open playlist in MPC"
                  }
                  onClick={openSelectedPlaylist}
                >
                  Open
                </button>
                <div className="bulk-actions" ref={bulkRef}>
                  <button
                    type="button"
                    className="btn"
                    disabled={moving}
                    aria-haspopup="menu"
                    aria-expanded={bulkOpen}
                    onClick={() => setBulkOpen((open) => !open)}
                  >
                    {moving ? "Moving…" : "Bulk actions"}
                  </button>
                  {bulkOpen && !moving && (
                    <div className="bulk-actions-menu" role="menu">
                      <button
                        type="button"
                        className="bulk-actions-item"
                        role="menuitem"
                        disabled={playlistPaths.length === 0}
                        title={
                          playlistPaths.length === 0
                            ? "No files in the playlist"
                            : "Move playlist files into a folder"
                        }
                        onClick={() => void movePlaylistFiles()}
                      >
                        Move
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div
              className={`selection-line${selectedRow ? " has-selection" : ""}`}
              title={selectedRow ? selectionPath(selectedRow) : undefined}
            >
              {selectedRow && (
                <>
                  Selected: <strong>#{selectionIndex(selectedRow)}</strong>{" "}
                  {truncateMiddle(selectionPath(selectedRow), 100)}
                </>
              )}
            </div>

            <div className="test-bar">
              <label htmlFor="test-pattern">
                Test pattern (full path) — + AND, !term exclude (e.g. abc+ght+!xyz)
              </label>
              <input
                id="test-pattern"
                className="text grow mono"
                placeholder="moh+mon+!aha"
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
              <label
                className="inline"
                title="Search the full catalog, ignoring include/ignore patterns"
              >
                <input
                  type="checkbox"
                  checked={testGlobalSearch}
                  onChange={(e) => setTestGlobalSearch(e.target.checked)}
                  disabled={!hasApplied}
                />
                Global search
              </label>
              {testGlobalSearch && testPattern.trim() && !globalSearchFiles && (
                <span className="hint">Loading catalog…</span>
              )}
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
              columns={settings.tableColumns}
              onColumnsChange={onTableColumnsChange}
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
