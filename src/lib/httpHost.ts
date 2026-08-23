import type {
  AppSettings,
  FileRecord,
  InitResponse,
  PlaylistItem,
  ScanProgress,
} from "./types";
import { BROWSER_HOST_URL, isBrowserHost } from "./runtime";

let sessionId: string | null = null;

export function clearBrowserSession(): void {
  sessionId = null;
}

export function getBrowserSessionId(): string | null {
  return sessionId;
}

async function hostFetch<T>(
  path: string,
  init?: RequestInit & { json?: unknown },
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.json !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (sessionId) {
    headers.set("X-Session-Id", sessionId);
  }

  const res = await fetch(path, {
    ...init,
    headers,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      typeof data?.error === "string" ? data.error : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

type InitSessionResponse = InitResponse & { sessionId: string };

export async function initBrowserSession(
  settings: AppSettings,
): Promise<InitResponse> {
  const res = await hostFetch<InitSessionResponse>("/api/session/init", {
    method: "POST",
    json: { settings },
  });
  sessionId = res.sessionId;
  const { sessionId: _sid, ...init } = res;
  return init;
}

export async function initBrowserSessionDefault(): Promise<InitResponse> {
  const res = await hostFetch<InitSessionResponse>("/api/session/default", {
    method: "POST",
    json: {},
  });
  sessionId = res.sessionId;
  const { sessionId: _sid, ...init } = res;
  return init;
}

export async function hostSaveSettings(
  settings: AppSettings,
): Promise<AppSettings> {
  return hostFetch<AppSettings>("/api/settings/save", {
    method: "POST",
    json: settings,
  });
}

export async function hostGetCatalogCount(): Promise<number> {
  return hostFetch<number>("/api/catalog/count");
}

export async function hostQueryFiles(args: {
  includeClauses: { terms: string[] }[];
  ignoreClauses: { terms: string[] }[];
  sortField: string;
  sortDir: string;
}): Promise<FileRecord[]> {
  return hostFetch<FileRecord[]>("/api/query", {
    method: "POST",
    json: {
      includeClauses: args.includeClauses,
      ignoreClauses: args.ignoreClauses,
      sortField: args.sortField,
      sortDir: args.sortDir,
    },
  });
}

export async function hostStartScan(settings: AppSettings): Promise<void> {
  await hostFetch("/api/scan/start", { method: "POST", json: settings });
}

export async function hostCancelScan(): Promise<void> {
  await hostFetch("/api/scan/cancel", { method: "POST", json: {} });
}

export async function hostGetScanProgress(): Promise<ScanProgress> {
  return hostFetch<ScanProgress>("/api/scan/progress");
}

export async function hostOpenFile(path: string): Promise<void> {
  await hostFetch("/api/open/file", { method: "POST", json: { path } });
}

export async function hostOpenPlaylist(items: PlaylistItem[]): Promise<string> {
  const res = await hostFetch<{ path: string }>("/api/open/playlist", {
    method: "POST",
    json: items,
  });
  return res.path;
}

export function browserHostEnabled(): boolean {
  return isBrowserHost();
}

export { BROWSER_HOST_URL };
