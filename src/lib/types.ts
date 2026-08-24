export type PatternEntry = {
  pattern: string;
  enabled: boolean;
};

export type AppSettings = {
  roots: string[];
  extensions: string[];
  includeRegexes: PatternEntry[];
  ignoreRegexes: PatternEntry[];
  sortField: string;
  sortDir: "asc" | "desc";
  splitBySearch: boolean;
  deepScan: boolean;
  /** Catalog SQLite path (absolute, or relative to data dir). */
  databasePath: string;
};

export type FileRecord = {
  path: string;
  ext: string;
  sizeBytes: number;
  atime: number;
  mtime: number;
  birthtime: number;
  durationMs: number | null;
  indexedAt: number;
};

export type ScanProgress = {
  phase: string;
  message: string;
  scanned: number;
  skipped: number;
  files: number;
  currentFolder: string;
};

export type PlaylistItem = {
  path: string;
  isDelimiter?: boolean;
};

export type InitResponse = {
  settings: AppSettings;
  catalogCount: number;
  dataDir: string;
  resolvedDatabasePath: string;
  settingsPath: string;
};

export type ResultRow =
  | {
      kind: "file";
      id: string;
      playlistIndex: number;
      file: FileRecord;
    }
  | {
      kind: "delimiter";
      id: string;
      label: string;
      playlistIndex: number;
      toggle?: "expand" | "collapse";
      groupKey?: string;
    }
  | {
      kind: "section";
      id: string;
      label: string;
      count: number;
      groupKey: string;
      collapsed: boolean;
    };

export const DEFAULT_EXTENSIONS = [
  ".mp4",
  ".mkv",
  ".avi",
  ".mov",
  ".wmv",
  ".webm",
  ".m4v",
  ".mp3",
  ".flac",
  ".wav",
  ".aac",
  ".ogg",
  ".m4a",
  ".wma",
];

export const SORT_FIELDS = [
  { value: "path", label: "Path" },
  { value: "ext", label: "Extension" },
  { value: "sizeBytes", label: "Size" },
  { value: "durationMs", label: "Duration" },
  { value: "mtime", label: "Modified" },
  { value: "atime", label: "Accessed" },
  { value: "birthtime", label: "Created" },
  { value: "indexedAt", label: "Indexed" },
  { value: "random", label: "Random" },
] as const;

export function defaultSettings(): AppSettings {
  return {
    roots: [],
    extensions: [...DEFAULT_EXTENSIONS],
    includeRegexes: [],
    ignoreRegexes: [],
    sortField: "path",
    sortDir: "asc",
    splitBySearch: false,
    deepScan: false,
    databasePath: "",
  };
}
