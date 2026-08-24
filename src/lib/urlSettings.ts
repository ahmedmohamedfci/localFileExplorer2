import {
  DEFAULT_EXTENSIONS,
  defaultSettings,
  type AppSettings,
  type PatternEntry,
} from "./types";
import { normalizeTableColumns } from "./tableColumns";

const HASH_KEY = "s";

/** Read settings from `#s=…` (URL only — never localStorage / sessionStorage). */
export function readSettingsFromHash():
  | { ok: true; settings: AppSettings }
  | { ok: false; error: string }
  | null {
  const raw = hashParam(HASH_KEY);
  if (raw == null || raw === "") return null;
  try {
    const json = utf8FromBase64Url(raw);
    return { ok: true, settings: parseSettingsJson(json) };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Invalid settings in URL",
    };
  }
}

/** Persist settings into the hash so refresh keeps this tab’s session. */
export function writeSettingsToHash(settings: AppSettings): void {
  const payload = base64UrlFromUtf8(JSON.stringify(settings));
  const url = new URL(window.location.href);
  url.hash = `${HASH_KEY}=${payload}`;
  history.replaceState(null, "", url.toString());
}

export function clearSettingsHash(): void {
  const url = new URL(window.location.href);
  url.hash = "";
  history.replaceState(null, "", url.toString());
}

export function parseSettingsJson(raw: string): AppSettings {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Not valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Settings must be a JSON object");
  }
  const obj = value as Record<string, unknown>;

  // Older field names
  if (obj.sortBySearch != null && obj.splitBySearch == null) {
    obj.splitBySearch = obj.sortBySearch;
  }
  if (obj.databasePath == null) {
    const legacy = obj.dbPath ?? obj.database_path;
    if (legacy != null) obj.databasePath = legacy;
  }

  const defaults = defaultSettings();
  return {
    roots: stringArray(obj.roots, defaults.roots),
    extensions: normalizeExtensions(
      stringArray(obj.extensions, [...DEFAULT_EXTENSIONS]),
    ),
    includeRegexes: patternArray(obj.includeRegexes),
    ignoreRegexes: patternArray(obj.ignoreRegexes),
    sortField:
      typeof obj.sortField === "string" && obj.sortField
        ? obj.sortField
        : defaults.sortField,
    sortDir: obj.sortDir === "desc" ? "desc" : "asc",
    splitBySearch: Boolean(obj.splitBySearch),
    deepScan: Boolean(obj.deepScan),
    databasePath:
      typeof obj.databasePath === "string" ? obj.databasePath : "",
    tableColumns: normalizeTableColumns(obj.tableColumns),
  };
}

function hashParam(key: string): string | null {
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return null;
  return new URLSearchParams(hash).get(key);
}

function stringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  return value.filter((v): v is string => typeof v === "string");
}

function patternArray(value: unknown): PatternEntry[] {
  if (!Array.isArray(value)) return [];
  const out: PatternEntry[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      out.push({ pattern: item, enabled: true });
    } else if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      if (typeof o.pattern === "string") {
        out.push({ pattern: o.pattern, enabled: o.enabled !== false });
      }
    }
  }
  return out;
}

function normalizeExtensions(exts: string[]): string[] {
  return exts
    .map((e) => {
      const t = e.trim().toLowerCase();
      if (!t) return "";
      return t.startsWith(".") ? t : `.${t}`;
    })
    .filter(Boolean);
}

function base64UrlFromUtf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function utf8FromBase64Url(payload: string): string {
  const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
