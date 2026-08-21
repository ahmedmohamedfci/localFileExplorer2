import { invoke } from "@tauri-apps/api/core";
import type {
  AppSettings,
  FileRecord,
  InitResponse,
  PlaylistItem,
  ScanProgress,
} from "./types";

export function initApp(dataDir?: string | null): Promise<InitResponse> {
  return invoke("init_app", { dataDir: dataDir ?? null });
}

export function saveSettings(settings: AppSettings): Promise<AppSettings> {
  return invoke("save_settings", { settings });
}

export function getCatalogCount(): Promise<number> {
  return invoke("get_catalog_count");
}

export function queryFiles(args: {
  includeClauses: { terms: string[] }[];
  ignoreClauses: { terms: string[] }[];
  sortField: string;
  sortDir: string;
}): Promise<FileRecord[]> {
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
  return invoke("start_scan", { settings });
}

export function cancelScan(): Promise<void> {
  return invoke("cancel_scan");
}

export function getScanProgress(): Promise<ScanProgress> {
  return invoke("get_scan_progress");
}

export function openFile(path: string): Promise<void> {
  return invoke("open_file", { path });
}

export function openPlaylist(items: PlaylistItem[]): Promise<string> {
  return invoke("open_playlist", { items });
}

export function pickFolder(): Promise<string | null> {
  return invoke("pick_folder");
}

export function pickDatabasePath(): Promise<string | null> {
  return invoke("pick_database_path");
}

export function exportSettings(settings: AppSettings): Promise<string | null> {
  return invoke("export_settings", { settings });
}

export function importSettings(): Promise<InitResponse | null> {
  return invoke("import_settings");
}

export function getResolvedDatabasePath(): Promise<string> {
  return invoke("get_resolved_database_path");
}
