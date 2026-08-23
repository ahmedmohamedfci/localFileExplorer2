use std::cell::RefCell;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use crate::models::{AppError, AppResult, AppSettings};

static DATA_DIR: OnceLock<PathBuf> = OnceLock::new();
static SETTINGS_FILE: OnceLock<PathBuf> = OnceLock::new();

thread_local! {
    static SESSION_OVERRIDE: RefCell<Option<(PathBuf, PathBuf)>> = const { RefCell::new(None) };
}

/// Run API logic under a browser session's data/settings paths (HTTP host).
pub fn with_session<F, R>(data_dir: PathBuf, settings_path: PathBuf, f: F) -> R
where
    F: FnOnce() -> R,
{
    SESSION_OVERRIDE.with(|slot| {
        *slot.borrow_mut() = Some((data_dir, settings_path));
        let out = f();
        *slot.borrow_mut() = None;
        out
    })
}

/// Resolve data dir + optional settings file from CLI / env before the UI loads.
///
/// - `--settings <path>` / `-s` / `LFE_SETTINGS` → use that JSON; data dir = its parent
/// - `--data-dir <path>` / `-d` / `LFE_DATA_DIR` → `{dir}/settings.json` (DB/playlist under dir)
/// - default → settings `{exeDir}/settings.json`, data dir `{exeDir}/data`
pub fn init_from_cli_and_env() -> AppResult<PathBuf> {
    if let Some(existing) = DATA_DIR.get() {
        return Ok(existing.clone());
    }

    let (settings_override, data_override) = parse_path_args();

    let settings_override = settings_override.or_else(|| {
        std::env::var("LFE_SETTINGS")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .map(PathBuf::from)
    });

    if let Some(settings) = settings_override {
        let settings = absolutize(&settings)?;
        if let Some(parent) = settings.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)?;
            }
        }
        let dir = settings
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| PathBuf::from("."));
        std::fs::create_dir_all(&dir)?;
        let _ = SETTINGS_FILE.set(settings);
        let _ = DATA_DIR.set(dir.clone());
        return Ok(dir);
    }

    init_data_dir(data_override)
}

fn parse_path_args() -> (Option<PathBuf>, Option<PathBuf>) {
    let args: Vec<String> = std::env::args().collect();
    let mut settings: Option<PathBuf> = None;
    let mut data_dir: Option<PathBuf> = None;
    let mut i = 1usize;
    while i < args.len() {
        let arg = args[i].as_str();
        if let Some(rest) = arg.strip_prefix("--settings=") {
            settings = Some(PathBuf::from(rest));
            i += 1;
            continue;
        }
        if let Some(rest) = arg.strip_prefix("--data-dir=") {
            data_dir = Some(PathBuf::from(rest));
            i += 1;
            continue;
        }
        match arg {
            "--settings" | "-s" => {
                if let Some(v) = args.get(i + 1) {
                    settings = Some(PathBuf::from(v));
                    i += 2;
                    continue;
                }
            }
            "--data-dir" | "-d" => {
                if let Some(v) = args.get(i + 1) {
                    data_dir = Some(PathBuf::from(v));
                    i += 2;
                    continue;
                }
            }
            _ => {}
        }
        i += 1;
    }
    (settings, data_dir)
}

fn absolutize(path: &Path) -> AppResult<PathBuf> {
    if path.is_absolute() {
        return Ok(path.to_path_buf());
    }
    let cwd = std::env::current_dir().map_err(AppError::Io)?;
    Ok(cwd.join(path))
}

pub fn init_data_dir(override_dir: Option<PathBuf>) -> AppResult<PathBuf> {
    if let Some(existing) = DATA_DIR.get() {
        return Ok(existing.clone());
    }

    let exe = std::env::current_exe().map_err(AppError::Io)?;
    let exe_dir = exe
        .parent()
        .ok_or_else(|| AppError::Message("Cannot resolve executable directory".into()))?
        .to_path_buf();

    let env_data_dir = std::env::var("LFE_DATA_DIR")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .map(PathBuf::from);

    let (dir, settings_beside_exe) = if let Some(path) = override_dir {
        (path, false)
    } else if let Some(custom) = env_data_dir {
        (custom, false)
    } else {
        (exe_dir.join("data"), true)
    };

    let dir = absolutize(&dir)?;
    std::fs::create_dir_all(&dir)?;

    // Default layout: settings next to the EXE; DB/playlist stay under `{exeDir}/data`.
    if settings_beside_exe && SETTINGS_FILE.get().is_none() {
        let settings = absolutize(&exe_dir.join("settings.json"))?;
        let _ = SETTINGS_FILE.set(settings);
    }

    let _ = DATA_DIR.set(dir.clone());
    Ok(dir)
}

pub fn data_dir() -> AppResult<PathBuf> {
    if let Some((dir, _)) = SESSION_OVERRIDE.with(|s| s.borrow().clone()) {
        return Ok(dir);
    }
    DATA_DIR
        .get()
        .cloned()
        .ok_or_else(|| AppError::Message("Data directory not initialized".into()))
}

pub fn settings_path() -> AppResult<PathBuf> {
    if let Some((_, settings)) = SESSION_OVERRIDE.with(|s| s.borrow().clone()) {
        return Ok(settings);
    }
    if let Some(path) = SETTINGS_FILE.get() {
        return Ok(path.clone());
    }
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
    // Isolate playlist when two instances share a folder via different --settings files.
    if let Some(settings) = SETTINGS_FILE.get() {
        let stem = settings
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "default".into());
        return Ok(data_dir()?.join(format!("playlist-{stem}.mpcpl")));
    }
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
