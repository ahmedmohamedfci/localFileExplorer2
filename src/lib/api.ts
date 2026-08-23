import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./runtime";
import type {
  AppSettings,
  FileRecord,
  InitResponse,
  PlaylistItem,
  ScanProgress,
} from "./types";
import { writeSettingsToHash } from "./urlSettings";

const browserHostHint =
  "This action needs the desktop app or the localhost host (not available in plain browser mode).";

function requireTauri<T>(): Promise<T> {
  return Promise.reject(new Error(browserHostHint));
}

export function initApp(dataDir?: string | null): Promise<InitResponse> {
  if (!isTauri()) return requireTauri();
  return invoke("init_app", { dataDir: dataDir ?? null });
}

export function saveSettings(settings: AppSettings): Promise<AppSettings> {
  if (!isTauri()) {
    writeSettingsToHash(settings);
    return Promise.resolve(settings);
  }
  return invoke("save_settings", { settings });
}

export function getCatalogCount(): Promise<number> {
  if (!isTauri()) return Promise.resolve(0);
  return invoke("get_catalog_count");
}

export function queryFiles(args: {
  includeClauses: { terms: string[] }[];
  ignoreClauses: { terms: string[] }[];
  sortField: string;
  sortDir: string;
}): Promise<FileRecord[]> {
  if (!isTauri()) return Promise.resolve([]);
  return invoke("query_files", {
    request: {
      includeClauses: args.includeClauses,
      ignoreClauses: args.ignoreClauses,
      sortField: args.sortField,
      sortDir: args.sortDir,
    },
  });
}

export function startScan(settings: AppSettings): Promise<void> {
  if (!isTauri()) return requireTauri();
  return invoke("start_scan", { settings });
}

export function cancelScan(): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  return invoke("cancel_scan");
}

export function getScanProgress(): Promise<ScanProgress> {
  if (!isTauri()) {
    return Promise.resolve({
      phase: "idle",
      message: "",
      scanned: 0,
      skipped: 0,
      files: 0,
      currentFolder: "",
    });
  }
  return invoke("get_scan_progress");
}

export function openFile(path: string): Promise<void> {
  if (!isTauri()) return requireTauri();
  return invoke("open_file", { path });
}

export function openPlaylist(items: PlaylistItem[]): Promise<string> {
  if (!isTauri()) return requireTauri();
  return invoke("open_playlist", { items });
}

export function pickFolder(): Promise<string | null> {
  if (!isTauri()) return requireTauri();
  return invoke("pick_folder");
}

export function pickDatabasePath(): Promise<string | null> {
  if (!isTauri()) return requireTauri();
  return invoke("pick_database_path");
}

export function exportSettings(settings: AppSettings): Promise<string | null> {
  if (!isTauri()) {
    const blob = new Blob([JSON.stringify(settings, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "lfe-settings.json";
    a.click();
    URL.revokeObjectURL(url);
    return Promise.resolve("download");
  }
  return invoke("export_settings", { settings });
}

export function importSettings(): Promise<InitResponse | null> {
  if (!isTauri()) return requireTauri();
  return invoke("import_settings");
}

export function getResolvedDatabasePath(): Promise<string> {
  if (!isTauri()) return Promise.resolve("");
  return invoke("get_resolved_database_path");
}
