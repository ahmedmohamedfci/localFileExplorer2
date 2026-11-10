import type { AppSettings, ScanProgress, UiLayout } from "../lib/types";
import { truncateMiddle } from "../lib/format";

type Props = {
  settings: AppSettings;
  dataDir: string;
  onChange: (settings: AppSettings) => void;
  onUiChange: (patch: Partial<UiLayout>) => void;
  onClose: () => void;
  onSaveAndScan: () => void;
  onCancelScan: () => void;
  onAddRoot: () => void;
  onBrowseDatabase: () => void;
  onExportSettings: () => void;
  onImportSettings: () => void;
  onExportCatalog: () => void;
  onImportCatalog: () => void;
  onSaveSettings: () => void;
  scanning: boolean;
  progress: ScanProgress;
  statusMessage: string | null;
  hostUrl?: string | null;
};

/** Full-stage settings view: Scan, Roots, Extensions, Data & settings. */
export function SettingsPanel({
  settings,
  dataDir,
  onChange,
  onUiChange,
  onClose,
  onSaveAndScan,
  onCancelScan,
  onAddRoot,
  onBrowseDatabase,
  onExportSettings,
  onImportSettings,
  onExportCatalog,
  onImportCatalog,
  onSaveSettings,
  scanning,
  progress,
  statusMessage,
  hostUrl,
}: Props) {
  const ui = settings.ui;

  return (
    <div className="pane settings-stage">
      <div className="results-header">
        <div>
          <h1 style={{ margin: 0, fontSize: 15 }}>Settings</h1>
          <div className="count">
            Scan, roots, extensions, data
          </div>
        </div>
        <button type="button" className="btn" onClick={onClose}>
          Back to results
        </button>
      </div>

      <div className="settings-scroll">
        <div className="section">
          <button
            type="button"
            className="section-toggle"
            onClick={() => onUiChange({ scanOpen: !ui.scanOpen })}
          >
            <span className="chevron">{ui.scanOpen ? "▼" : "▶"}</span>
            <strong>Scan</strong>
            <span style={{ color: "var(--text-muted)" }}>({progress.phase})</span>
          </button>
          {ui.scanOpen && (
            <div className="section-body">
              <div className="field-row" style={{ flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={onSaveAndScan}
                  disabled={scanning}
                >
                  Save &amp; scan
                </button>
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={settings.deepScan}
                    onChange={(e) =>
                      onChange({ ...settings, deepScan: e.target.checked })
                    }
                  />
                  Deep scan (catch renames)
                </label>
                {scanning && (
                  <button type="button" className="btn" onClick={onCancelScan}>
                    Cancel scan
                  </button>
                )}
              </div>
              {progress.message && <div>{progress.message}</div>}
              <div className="scan-stats">
                scanned {progress.scanned} · skipped {progress.skipped} · files{" "}
                {progress.files}
              </div>
              {progress.currentFolder && (
                <div className="current-folder" title={progress.currentFolder}>
                  {truncateMiddle(progress.currentFolder, 90)}
                </div>
              )}
              {statusMessage && <p className="status-text">{statusMessage}</p>}
            </div>
          )}
        </div>

        <div className="section">
          <button
            type="button"
            className="section-toggle"
            onClick={() => onUiChange({ rootsOpen: !ui.rootsOpen })}
          >
            <span className="chevron">{ui.rootsOpen ? "▼" : "▶"}</span>
            <strong>Roots</strong>
          </button>
          {ui.rootsOpen && (
            <div className="section-body">
              {settings.roots.length === 0 && (
                <div className="empty-note">No folders yet</div>
              )}
              {settings.roots.map((root) => (
                <div className="root-item" key={root}>
                  <span title={root}>{root}</span>
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={() =>
                      onChange({
                        ...settings,
                        roots: settings.roots.filter((r) => r !== root),
                      })
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
              <button type="button" className="btn" onClick={onAddRoot}>
                Add folder…
              </button>
            </div>
          )}
        </div>

        <div className="section">
          <button
            type="button"
            className="section-toggle"
            onClick={() => onUiChange({ extOpen: !ui.extOpen })}
          >
            <span className="chevron">{ui.extOpen ? "▼" : "▶"}</span>
            <strong>Extensions</strong>
          </button>
          {ui.extOpen && (
            <div className="section-body">
              <p className="hint">One per line (e.g. .mp4)</p>
              <textarea
                value={settings.extensions.join("\n")}
                onChange={(e) =>
                  onChange({
                    ...settings,
                    extensions: e.target.value.split(/\r?\n/),
                  })
                }
              />
            </div>
          )}
        </div>

        <div className="section">
          <button
            type="button"
            className="section-toggle"
            onClick={() => onUiChange({ dataOpen: !ui.dataOpen })}
          >
            <span className="chevron">{ui.dataOpen ? "▼" : "▶"}</span>
            <strong>Data &amp; settings</strong>
          </button>
          {ui.dataOpen && (
            <div className="section-body">
              {hostUrl && (
                <p className="hint">
                  Browser UI:{" "}
                  <a href={hostUrl} target="_blank" rel="noreferrer">
                    {hostUrl}
                  </a>
                </p>
              )}
              <p className="hint">
                Settings file stays in the app data folder. Catalog DB path is stored in
                settings.json and can point anywhere.
              </p>
              <label className="hint" htmlFor="context-name">
                Context name (window title)
              </label>
              <div className="field-row">
                <input
                  id="context-name"
                  type="text"
                  value={settings.contextName}
                  onChange={(e) =>
                    onChange({ ...settings, contextName: e.target.value })
                  }
                  placeholder="e.g. audio"
                />
              </div>
              <p className="hint mono" title={dataDir}>
                Data folder: {truncateMiddle(dataDir, 72)}
              </p>
              <label className="hint" htmlFor="db-path">
                Database path
              </label>
              <div className="field-row">
                <input
                  id="db-path"
                  type="text"
                  className="mono"
                  value={settings.databasePath}
                  onChange={(e) =>
                    onChange({ ...settings, databasePath: e.target.value })
                  }
                  placeholder="file-index.db"
                />
                <button type="button" className="btn" onClick={onBrowseDatabase}>
                  Browse…
                </button>
              </div>
              <div className="field-row" style={{ marginTop: 8 }}>
                <button type="button" className="btn" onClick={onSaveSettings}>
                  Save settings
                </button>
                <button type="button" className="btn" onClick={onExportSettings}>
                  Export settings…
                </button>
                <button type="button" className="btn" onClick={onImportSettings}>
                  Import settings…
                </button>
              </div>
              <div className="field-row" style={{ marginTop: 8 }}>
                <button type="button" className="btn" onClick={onExportCatalog}>
                  Export DB JSON…
                </button>
                <button type="button" className="btn" onClick={onImportCatalog}>
                  Import DB JSON…
                </button>
              </div>
              <p className="hint">
                Catalog import upserts by path (primary key): updates existing rows
                or inserts new ones. Indexed time is kept for paths already in the DB.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** @deprecated Use SettingsPanel — kept as alias for any leftover imports */
export const ControlsPane = SettingsPanel;
