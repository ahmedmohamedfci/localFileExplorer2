import { invoke } from "@tauri-apps/api/core";
import { isBrowserHost, isTauri } from "./runtime";
import * as host from "./httpHost";
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

function requireHostOrTauri<T>(): Promise<T> {
  return Promise.reject(new Error(browserHostHint));
}

export function initApp(dataDir?: string | null): Promise<InitResponse> {
  if (isTauri()) return invoke("init_app", { dataDir: dataDir ?? null });
  if (isBrowserHost()) return requireHostOrTauri();
  return requireHostOrTauri();
}

export function initBrowserSession(settings: AppSettings): Promise<InitResponse> {
  if (!isBrowserHost()) return requireHostOrTauri();
  return host.initBrowserSession(settings);
}

export function initBrowserSessionDefault(): Promise<InitResponse> {
  if (!isBrowserHost()) return requireHostOrTauri();
  return host.initBrowserSessionDefault();
}

export function saveSettings(settings: AppSettings): Promise<AppSettings> {
  if (isTauri()) return invoke("save_settings", { settings });
  if (isBrowserHost()) {
    writeSettingsToHash(settings);
    return host.hostSaveSettings(settings);
  }
  writeSettingsToHash(settings);
  return Promise.resolve(settings);
}

export function getCatalogCount(): Promise<number> {
  if (isTauri()) return invoke("get_catalog_count");
  if (isBrowserHost()) return host.hostGetCatalogCount();
  return Promise.resolve(0);
}

export function queryFiles(args: {
  includeClauses: { terms: string[] }[];
  ignoreClauses: { terms: string[] }[];
  sortField: string;
  sortDir: string;
}): Promise<FileRecord[]> {
  if (isTauri()) {
    return invoke("query_files", {
      request: {
        includeClauses: args.includeClauses,
        ignoreClauses: args.ignoreClauses,
        sortField: args.sortField,
        sortDir: args.sortDir,
      },
    });
  }
  if (isBrowserHost()) return host.hostQueryFiles(args);
  return Promise.resolve([]);
}

export function startScan(settings: AppSettings): Promise<void> {
  if (isTauri()) return invoke("start_scan", { settings });
  if (isBrowserHost()) return host.hostStartScan(settings);
  return requireHostOrTauri();
}

export function cancelScan(): Promise<void> {
  if (isTauri()) return invoke("cancel_scan");
  if (isBrowserHost()) return host.hostCancelScan();
  return Promise.resolve();
}

export function getScanProgress(): Promise<ScanProgress> {
  if (isTauri()) return invoke("get_scan_progress");
  if (isBrowserHost()) return host.hostGetScanProgress();
  return Promise.resolve({
    phase: "idle",
    message: "",
    scanned: 0,
    skipped: 0,
    files: 0,
    currentFolder: "",
  });
}

export function openFile(path: string): Promise<void> {
  if (isTauri()) return invoke("open_file", { path });
  if (isBrowserHost()) return host.hostOpenFile(path);
  return requireHostOrTauri();
}

export function openPlaylist(items: PlaylistItem[]): Promise<string> {
  if (isTauri()) return invoke("open_playlist", { items });
  if (isBrowserHost()) return host.hostOpenPlaylist(items);
  return requireHostOrTauri();
}

export function pickFolder(): Promise<string | null> {
  if (isTauri()) return invoke("pick_folder");
  if (isBrowserHost()) return host.hostPickFolder();
  return requireHostOrTauri();
}

export function pickDatabasePath(): Promise<string | null> {
  if (isTauri()) return invoke("pick_database_path");
  if (isBrowserHost()) return host.hostPickDatabasePath();
  return requireHostOrTauri();
}

export function exportSettings(settings: AppSettings): Promise<string | null> {
  if (isTauri()) return invoke("export_settings", { settings });
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

export async function importSettings(): Promise<InitResponse | null> {
  if (isTauri()) return invoke("import_settings");
  if (isBrowserHost()) {
    const imported = await host.hostImportSettings();
    if (imported) writeSettingsToHash(imported.settings);
    return imported;
  }
  return requireHostOrTauri();
}

export function getResolvedDatabasePath(): Promise<string> {
  if (isTauri()) return invoke("get_resolved_database_path");
  return Promise.resolve("");
}

export function getHostUrl(): Promise<string> {
  if (isTauri()) return invoke("get_host_url");
  if (isBrowserHost() && typeof window !== "undefined") {
    return Promise.resolve(`${window.location.origin}/`);
  }
  return Promise.resolve(host.BROWSER_HOST_URL);
}

export { BROWSER_HOST_URL } from "./runtime";
