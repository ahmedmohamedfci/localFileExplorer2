use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Db(#[from] rusqlite::Error),
    #[error(transparent)]
    Regex(#[from] regex::Error),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatternEntry {
    pub pattern: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableColumnConfig {
    pub id: String,
    pub width: u32,
    pub visible: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub roots: Vec<String>,
    pub extensions: Vec<String>,
    pub include_regexes: Vec<PatternEntry>,
    pub ignore_regexes: Vec<PatternEntry>,
    pub sort_field: String,
    pub sort_dir: String,
    pub split_by_search: bool,
    pub deep_scan: bool,
    /// Catalog SQLite path. Absolute, or relative to the app data folder.
    /// Empty = `{dataDir}/file-index.db`.
    #[serde(default)]
    pub database_path: String,
    #[serde(default = "default_table_columns")]
    pub table_columns: Vec<TableColumnConfig>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            roots: Vec::new(),
            extensions: default_extensions(),
            include_regexes: Vec::new(),
            ignore_regexes: Vec::new(),
            sort_field: "path".into(),
            sort_dir: "asc".into(),
            split_by_search: false,
            deep_scan: false,
            database_path: String::new(),
            table_columns: default_table_columns(),
        }
    }
}

fn default_table_columns() -> Vec<TableColumnConfig> {
    [
        ("index", 56, true),
        ("path", 480, true),
        ("ext", 64, true),
        ("sizeBytes", 84, true),
        ("durationMs", 84, true),
        ("mtime", 150, true),
        ("atime", 150, false),
        ("birthtime", 150, false),
        ("indexedAt", 150, false),
    ]
    .into_iter()
    .map(|(id, width, visible)| TableColumnConfig {
        id: id.into(),
        width,
        visible,
    })
    .collect()
}

pub fn default_extensions() -> Vec<String> {
    [
        ".mp4", ".mkv", ".avi", ".mov", ".wmv", ".webm", ".m4v", ".mp3", ".flac", ".wav",
        ".aac", ".ogg", ".m4a", ".wma",
    ]
    .into_iter()
    .map(str::to_string)
    .collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRecord {
    pub path: String,
    pub ext: String,
    pub size_bytes: i64,
    pub atime: f64,
    pub mtime: f64,
    pub birthtime: f64,
    pub duration_ms: Option<f64>,
    pub indexed_at: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub phase: String,
    pub message: String,
    pub scanned: u64,
    pub skipped: u64,
    pub files: u64,
    pub current_folder: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatternClause {
    /// All terms must match the full path (AND). Multiple clauses are OR'd.
    pub terms: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryRequest {
    pub include_clauses: Vec<PatternClause>,
    pub ignore_clauses: Vec<PatternClause>,
    pub sort_field: String,
    pub sort_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitResponse {
    pub settings: AppSettings,
    pub catalog_count: i64,
    pub data_dir: String,
    pub resolved_database_path: String,
    pub settings_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistItem {
    pub path: String,
    #[serde(default)]
    pub is_delimiter: bool,
}
