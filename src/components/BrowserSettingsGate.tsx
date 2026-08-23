import { useCallback, useRef, useState, type DragEvent } from "react";
import { defaultSettings, type AppSettings } from "../lib/types";
import { parseSettingsJson, writeSettingsToHash } from "../lib/urlSettings";

type Props = {
  /** Shown when URL had `#s=` but it could not be decoded. */
  urlError?: string | null;
  onReady: (settings: AppSettings) => void;
};

export function BrowserSettingsGate({ urlError, onReady }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(urlError ?? null);
  const [busy, setBusy] = useState(false);

  const applyRaw = useCallback(
    async (raw: string, label: string) => {
      setBusy(true);
      setError(null);
      try {
        const settings = parseSettingsJson(raw);
        writeSettingsToHash(settings);
        onReady(settings);
      } catch (e) {
        setError(
          e instanceof Error
            ? `${label}: ${e.message}`
            : `Could not read ${label}`,
        );
      } finally {
        setBusy(false);
      }
    },
    [onReady],
  );

  const applyFile = useCallback(
    async (file: File) => {
      const raw = await file.text();
      await applyRaw(raw, file.name || "settings.json");
    },
    [applyRaw],
  );

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void applyFile(file);
  }

  function useDefaults() {
    const settings = defaultSettings();
    writeSettingsToHash(settings);
    onReady(settings);
  }

  return (
    <div className="gate">
      <div className="gate-card">
        <h1 className="gate-title">Local File Explorer</h1>
        <p className="gate-lead">
          Drop or select a <code>settings.json</code> for this tab. Settings are
          kept in the URL only — a new tab always starts here.
        </p>

        <div
          className={`gate-drop${dragging ? " is-dragging" : ""}${busy ? " is-busy" : ""}`}
          onDragEnter={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setDragging(false);
          }}
          onDrop={onDrop}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          onClick={() => inputRef.current?.click()}
        >
          <strong>Drop settings.json here</strong>
          <span>or click to choose a file</span>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void applyFile(file);
          }}
        />

        <div className="gate-actions">
          <button type="button" className="btn" disabled={busy} onClick={useDefaults}>
            Continue with defaults
          </button>
        </div>

        {error && <p className="error-text gate-error">{error}</p>}

        <p className="gate-hint">
          Full scan and catalog features need the desktop app (or the localhost
          host). This browser view loads settings into the UI for this tab.
        </p>
      </div>
    </div>
  );
}
