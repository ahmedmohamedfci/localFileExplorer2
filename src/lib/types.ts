import {
  DEFAULT_TABLE_COLUMNS,
  normalizeTableColumns,
  type TableColumnConfig,
} from "./tableColumns";

export type PatternEntry = {
  pattern: string;
  enabled: boolean;
};

/** Open/collapsed layout remembered across launches. */
export type UiLayout = {
  leftPaneOpen: boolean;
  settingsOpen: boolean;
  includePatternsOpen: boolean;
  ignorePatternsOpen: boolean;
  scanOpen: boolean;
  rootsOpen: boolean;
  extOpen: boolean;
  dataOpen: boolean;
  howToOpen: boolean;
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
  /** Results table columns (order, width, visibility). */
  tableColumns: TableColumnConfig[];
  /** Pane / section open state. */
  ui: UiLayout;
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
  { value: "name", label: "Name" },
  { value: "ext", label: "Extension" },
  { value: "sizeBytes", label: "Size" },
  { value: "durationMs", label: "Duration" },
  { value: "mtime", label: "Modified" },
  { value: "atime", label: "Accessed" },
  { value: "birthtime", label: "Created" },
  { value: "indexedAt", label: "Indexed" },
  { value: "random", label: "Random" },
] as const;

export function defaultUiLayout(): UiLayout {
  return {
    leftPaneOpen: true,
    settingsOpen: false,
    includePatternsOpen: true,
    ignorePatternsOpen: true,
    scanOpen: true,
    rootsOpen: true,
    extOpen: false,
    dataOpen: false,
    howToOpen: false,
  };
}

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
    tableColumns: DEFAULT_TABLE_COLUMNS.map((c) => ({ ...c })),
    ui: defaultUiLayout(),
  };
}

function hydrateUi(raw: unknown): UiLayout {
  const defaults = defaultUiLayout();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaults;
  const o = raw as Record<string, unknown>;
  return {
    leftPaneOpen: typeof o.leftPaneOpen === "boolean" ? o.leftPaneOpen : defaults.leftPaneOpen,
    settingsOpen: typeof o.settingsOpen === "boolean" ? o.settingsOpen : defaults.settingsOpen,
    includePatternsOpen:
      typeof o.includePatternsOpen === "boolean"
        ? o.includePatternsOpen
        : defaults.includePatternsOpen,
    ignorePatternsOpen:
      typeof o.ignorePatternsOpen === "boolean"
        ? o.ignorePatternsOpen
        : defaults.ignorePatternsOpen,
    scanOpen: typeof o.scanOpen === "boolean" ? o.scanOpen : defaults.scanOpen,
    rootsOpen: typeof o.rootsOpen === "boolean" ? o.rootsOpen : defaults.rootsOpen,
    extOpen: typeof o.extOpen === "boolean" ? o.extOpen : defaults.extOpen,
    dataOpen: typeof o.dataOpen === "boolean" ? o.dataOpen : defaults.dataOpen,
    howToOpen: typeof o.howToOpen === "boolean" ? o.howToOpen : defaults.howToOpen,
  };
}

/** Fill missing/legacy fields after loading settings from disk or API. */
export function hydrateSettings(raw: AppSettings): AppSettings {
  return {
    ...defaultSettings(),
    ...raw,
    tableColumns: normalizeTableColumns(raw.tableColumns),
    ui: hydrateUi(raw.ui),
  };
}
