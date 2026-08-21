use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use crate::models::{AppError, AppResult, AppSettings};

static DATA_DIR: OnceLock<PathBuf> = OnceLock::new();

pub fn init_data_dir(override_dir: Option<PathBuf>) -> AppResult<PathBuf> {
    if let Some(existing) = DATA_DIR.get() {
        return Ok(existing.clone());
    }

    let dir = if let Some(path) = override_dir {
        path
    } else if let Ok(custom) = std::env::var("LFE_DATA_DIR") {
        PathBuf::from(custom)
    } else {
        let exe = std::env::current_exe().map_err(AppError::Io)?;
        let parent = exe
            .parent()
            .ok_or_else(|| AppError::Message("Cannot resolve executable directory".into()))?;
        parent.join("data")
    };

    std::fs::create_dir_all(&dir)?;
    let _ = DATA_DIR.set(dir.clone());
    Ok(dir)
}

pub fn data_dir() -> AppResult<PathBuf> {
    DATA_DIR
        .get()
        .cloned()
        .ok_or_else(|| AppError::Message("Data directory not initialized".into()))
}

pub fn settings_path() -> AppResult<PathBuf> {
    Ok(data_dir()?.join("settings.json"))
}

pub fn default_database_path() -> AppResult<PathBuf> {
    Ok(data_dir()?.join("file-index.db"))
}

/// Resolve catalog DB path from settings (`databasePath`).
/// Empty → `{dataDir}/file-index.db`. Relative → under data dir. Absolute → as-is.
pub fn resolve_database_path(settings: &AppSettings) -> AppResult<PathBuf> {
    let raw = settings.database_path.trim();
    if raw.is_empty() {
        return default_database_path();
    }
    let path = PathBuf::from(raw);
    if path.is_absolute() {
        Ok(path)
    } else {
        Ok(data_dir()?.join(path))
    }
}

pub fn db_path() -> AppResult<PathBuf> {
    // Late-bind through current settings.json so path edits apply on next open.
    let settings = crate::settings::load_settings_raw().unwrap_or_default();
    resolve_database_path(&settings)
}

pub fn playlist_path() -> AppResult<PathBuf> {
    Ok(data_dir()?.join("playlist.mpcpl"))
}

pub fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().replace('/', "\\")
}

pub fn ensure_parent_dir(path: &Path) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }
    Ok(())
}
