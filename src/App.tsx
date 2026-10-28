import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { BrowserSettingsGate } from "./components/BrowserSettingsGate";
import { SettingsPanel } from "./components/ControlsPane";
import { FileFilterPane } from "./components/FileFilterPane";
import { ResultsTable, type TableSortField } from "./components/ResultsTable";
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
  type MoveProgress,
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
  const [moveProgress, setMoveProgress] = useState<MoveProgress | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const bulkRef = useRef<HTMLDivElement>(null);
  const autoUpdateStarted = useRef(false);
  const lastScanPhase = useRef<string>("idle");
  const skipAutoApply = useRef(true);
  const autoApplyTimer = useRef<number | null>(null);
  const [hostUrl, setHostUrl] = useState<string | null>(null);

  const leftPaneOpen = settings.ui.leftPaneOpen;
  const settingsOpen = settings.ui.settingsOpen;

  function applyScanProgress(next: ScanProgress) {
    setProgress(next);
    setScanning(next.phase === "scanning");
    if (next.phase === "done") {
      setCatalogCount(next.files);
    }
    if (next.phase === lastScanPhase.current) return;
    lastScanPhase.current = next.phase;
    if (next.phase === "done") {
      setStatusMessage("DB updated");
    } else if (next.phase === "error") {
      setStatusMessage(next.message);
    } else if (next.message === "Scan cancelled") {
      setStatusMessage("Scan cancelled");
      setScanning(false);
    } else if (next.phase === "scanning") {
      setStatusMessage("Updating DB…");
    }
  }

  /** Quiet catalog refresh on boot (roots required). Safe to call once per session. */
  function startBackgroundDbUpdate(next: AppSettings) {
    if (autoUpdateStarted.current) return;
    if (next.roots.length === 0) return;
    autoUpdateStarted.current = true;
    setScanning(true);
    setStatusMessage("Updating DB…");
    void api.startScan(next).catch((e) => {
      setScanning(false);
      setStatusMessage(e instanceof Error ? e.message : String(e));
    });
  }

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
        const hydrated = hydrateSettings(init.settings);
        setSettings(hydrated);
        setDataDir(init.dataDir);
        setCatalogCount(init.catalogCount);
        setProgress((p) => ({ ...p, files: init.catalogCount }));
        syncWindowTitle(hydrated.contextName);
        setShowBrowserGate(false);
        setGateUrlError(null);
        setBootError(null);
        setReady(true);
        startBackgroundDbUpdate(hydrated);
      } else {
        enterWithSettings(next, "(browser — URL settings)");
        return;
      }
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
        const hydrated = hydrateSettings(init.settings);
        setSettings(hydrated);
        setDataDir(init.dataDir);
        setCatalogCount(init.catalogCount);
        setProgress((p) => ({ ...p, files: init.catalogCount }));
        syncWindowTitle(hydrated.contextName);
        setHostUrl(await api.getHostUrl());
        setReady(true);
        const unlistenScan = await listen<ScanProgress>("scan-progress", (event) => {
          applyScanProgress(event.payload);
        });
        const unlistenMove = await listen<MoveProgress>("move-progress", (event) => {
          applyMoveProgress(event.payload);
        });
        unlisten = () => {
          unlistenScan();
          unlistenMove();
        };
        startBackgroundDbUpdate(hydrated);
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
        applyScanProgress(next);
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
    if (!testGlobalSearch || !hasApplied || !testPattern.trim()) {
      setGlobalSearchFiles(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // Query only matches for the test pattern — never load the full catalog into JS.
        const compiled = compileUserPattern(testPattern.trim());
        if (!compiled.ok) {
          if (!cancelled) setGlobalSearchFiles([]);
          return;
        }
        const result = await api.queryFiles({
          includeClauses: [compiled.clause],
          ignoreClauses: [],
          sortField: settings.sortField,
          sortDir: settings.sortDir,
          discardPath: settings.discardPath,
          limit: settings.splitBySearch ? 0 : settings.numFiles,
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
    testPattern,
    hasApplied,
    catalogCount,
    settings.sortField,
    settings.sortDir,
    settings.discardPath,
    settings.numFiles,
    settings.splitBySearch,
  ]);

  const globalSearchActive = Boolean(testGlobalSearch && testPattern.trim());
  const filesForDisplay = globalSearchActive ? (globalSearchFiles ?? []) : files;

  const { rows, displayedFileCount, testError } = useMemo(
    () =>
      buildDisplayRows({
        files: filesForDisplay,
        includePatterns: settings.includeRegexes,
        splitBySearch: settings.splitBySearch,
        // Limit already applied server-side when not split; with split, still cap per section here.
        numFiles: settings.splitBySearch ? settings.numFiles : 0,
        // Global search already filtered on the server — don't filter again client-side.
        testPattern: globalSearchActive ? "" : testPattern,
        collapsedGroups,
      }),
    [
      filesForDisplay,
      settings.includeRegexes,
      settings.splitBySearch,
      settings.numFiles,
      testPattern,
      globalSearchActive,
      collapsedGroups,
    ],
  );

  function updateSettings(next: AppSettings) {
    setSettings(next);
  }

  function applyMoveProgress(next: MoveProgress) {
    setMoveProgress(next);
    setMoving(next.phase === "moving");
    if (next.phase === "done" || next.phase === "cancelled" || next.phase === "error") {
      if (next.result?.renames.length) {
        const map = new Map(next.result.renames.map((r) => [r.from, r.to]));
        const remap = (list: FileRecord[]) =>
          list.map((file) => {
            const to = map.get(file.path);
            return to ? { ...file, path: to } : file;
          });
        setFiles((prev) => remap(prev));
        setGlobalSearchFiles((prev) => (prev ? remap(prev) : prev));
      }
      if (next.phase === "error") {
        setStatusMessage(next.message);
      } else if (next.result) {
        setStatusMessage(
          next.phase === "cancelled"
            ? `Move stopped. ${formatMoveStatus(next.result)}`
            : formatMoveStatus(next.result),
        );
      }
      window.setTimeout(() => setMoveProgress(null), 400);
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
      // Server returns only matches (and optionally a hard cap). Never the full catalog.
      const result = await api.queryFiles({
        includeClauses: compiledInclude.clauses,
        ignoreClauses: compiledIgnore.clauses,
        sortField: saved.sortField,
        sortDir: saved.sortDir,
        discardPath: saved.discardPath,
        // With split-by-search, per-section caps are applied when building rows.
        limit: saved.splitBySearch ? 0 : saved.numFiles,
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

  // Stable signature so saving settings after apply doesn't retrigger (new array refs).
  const filterApplyKey = useMemo(
    () =>
      JSON.stringify({
        includeRegexes: settings.includeRegexes,
        ignoreRegexes: settings.ignoreRegexes,
        sortField: settings.sortField,
        sortDir: settings.sortDir,
        discardPath: settings.discardPath,
        splitBySearch: settings.splitBySearch,
        numFiles: settings.numFiles,
      }),
    [
      settings.includeRegexes,
      settings.ignoreRegexes,
      settings.sortField,
      settings.sortDir,
      settings.discardPath,
      settings.splitBySearch,
      settings.numFiles,
    ],
  );

  // Auto-apply when filter/sort controls change (debounced). Skip the initial mount.
  useEffect(() => {
    if (!ready) return;
    if (skipAutoApply.current) {
      skipAutoApply.current = false;
      return;
    }
    if (autoApplyTimer.current != null) {
      window.clearTimeout(autoApplyTimer.current);
    }
    autoApplyTimer.current = window.setTimeout(() => {
      void applyFilter(settings);
    }, 350);
    return () => {
      if (autoApplyTimer.current != null) {
        window.clearTimeout(autoApplyTimer.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, filterApplyKey]);

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
      setMoveProgress({
        phase: "moving",
        message: `Moving 0 / ${paths.length}…`,
        current: 0,
        total: paths.length,
        currentFile: "",
      });
      setStatusMessage(`Moving ${paths.length} files…`);
      if (isTauri()) {
        await api.startMoveFiles(paths, destination);
        return;
      }
      // Browser host: synchronous fallback (no cancel UI channel yet).
      const result = await api.moveFiles(paths, destination);
      applyMoveProgress({
        phase: "done",
        message: formatMoveStatus(result),
        current: paths.length,
        total: paths.length,
        currentFile: "",
        result,
      });
    } catch (e) {
      setMoving(false);
      setMoveProgress(null);
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
    // Auto-apply debounces a fresh server query (correct for Random reshuffles too).
    setSettings({ ...settings, sortField: field, sortDir: nextDir });
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
                  const hydrated = hydrateSettings(init.settings);
                  setSettings(hydrated);
                  setDataDir(init.dataDir);
                  setCatalogCount(init.catalogCount);
                  setProgress((p) => ({ ...p, files: init.catalogCount }));
                  syncWindowTitle(hydrated.contextName);
                  setShowBrowserGate(false);
                  setGateUrlError(null);
                  setBootError(null);
                  setReady(true);
                  startBackgroundDbUpdate(hydrated);
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
      {moveProgress && (
        <div className="move-dialog-backdrop" role="presentation">
          <div
            className="move-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="move-dialog-title"
          >
            <h2 id="move-dialog-title">Moving files</h2>
            <p className="move-dialog-status">{moveProgress.message}</p>
            <div className="move-dialog-bar">
              <div
                className="move-dialog-bar-fill"
                style={{
                  width:
                    moveProgress.total > 0
                      ? `${Math.min(
                          100,
                          (100 * moveProgress.current) / moveProgress.total,
                        )}%`
                      : "0%",
                }}
              />
            </div>
            <p className="move-dialog-file mono" title={moveProgress.currentFile}>
              {moveProgress.currentFile
                ? truncateMiddle(moveProgress.currentFile, 72)
                : "\u00a0"}
            </p>
            <div className="move-dialog-actions">
              {moveProgress.phase === "moving" ? (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => void api.cancelMoveFiles()}
                >
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  className="btn"
                  onClick={() => setMoveProgress(null)}
                >
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      )}
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
