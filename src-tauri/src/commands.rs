use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::db::CatalogDb;
use crate::models::{
    AppError, AppResult, AppSettings, FileRecord, InitResponse, PlaylistItem, QueryRequest,
    ScanProgress,
};
use crate::paths::{self, path_to_string};
use crate::playlist::{clear_playlist, open_path, write_and_open_playlist};
use crate::scan::{filter_and_sort, run_scan};
use crate::settings::{self, normalize_extensions};
use crate::state::AppState;

#[tauri::command]
pub fn init_app(data_dir: Option<String>) -> AppResult<InitResponse> {
    // Prefer CLI/env already applied at process start. Frontend override only if unset.
    let dir = match paths::data_dir() {
        Ok(dir) => dir,
        Err(_) => {
            let override_dir = data_dir.map(std::path::PathBuf::from);
            if override_dir.is_some() {
                paths::init_data_dir(override_dir)?
            } else {
                paths::init_from_cli_and_env()?
            }
        }
    };
    let _ = clear_playlist();
    let settings = settings::load_settings()?;
    let resolved = paths::resolve_database_path(&settings)?;
    paths::ensure_parent_dir(&resolved)?;
    let catalog_count = CatalogDb::open()?.catalog_count()?;
    Ok(InitResponse {
        settings,
        catalog_count,
        data_dir: path_to_string(&dir),
        resolved_database_path: path_to_string(&resolved),
    })
}

#[tauri::command]
pub fn get_settings() -> AppResult<AppSettings> {
    settings::load_settings()
}

#[tauri::command]
pub fn save_settings(mut settings: AppSettings) -> AppResult<AppSettings> {
    settings.extensions = normalize_extensions(&settings.extensions);
    settings.database_path = settings.database_path.trim().to_string();
    if settings.database_path.is_empty() {
        settings.database_path = path_to_string(&paths::default_database_path()?);
    }
    let resolved = paths::resolve_database_path(&settings)?;
    paths::ensure_parent_dir(&resolved)?;
    settings::save_settings(&settings)?;
    Ok(settings)
}

#[tauri::command]
pub fn get_catalog_count() -> AppResult<i64> {
    CatalogDb::open()?.catalog_count()
}

#[tauri::command]
pub fn get_resolved_database_path() -> AppResult<String> {
    let settings = settings::load_settings()?;
    Ok(path_to_string(&paths::resolve_database_path(&settings)?))
}

#[tauri::command]
pub fn query_files(request: QueryRequest) -> AppResult<Vec<FileRecord>> {
    let files = CatalogDb::open()?.query_all()?;
    filter_and_sort(
        files,
        &request.include_clauses,
        &request.ignore_clauses,
        &request.sort_field,
        &request.sort_dir,
    )
}

#[tauri::command]
pub fn start_scan(app: AppHandle, state: State<'_, AppState>, mut settings: AppSettings) -> AppResult<()> {
    {
        let mut scanning = state.scanning.lock();
        if *scanning {
            return Err(AppError::Message("Scan already running".into()));
        }
        *scanning = true;
    }

    settings.extensions = normalize_extensions(&settings.extensions);
    settings.database_path = settings.database_path.trim().to_string();
    if settings.database_path.is_empty() {
        settings.database_path = path_to_string(&paths::default_database_path()?);
    }
    paths::ensure_parent_dir(&paths::resolve_database_path(&settings)?)?;
    settings::save_settings(&settings)?;

    let cancel = Arc::new(AtomicBool::new(false));
    *state.cancel.lock() = Some(cancel.clone());

    *state.last_progress.lock() = ScanProgress {
        phase: "scanning".into(),
        message: "Scanning…".into(),
        scanned: 0,
        skipped: 0,
        files: 0,
        current_folder: String::new(),
    };

    std::thread::spawn(move || {
        let result = run_scan(app.clone(), &settings, cancel);
        match result {
            Ok(progress) => {
                if let Some(st) = app.try_state::<AppState>() {
                    *st.last_progress.lock() = progress.clone();
                    *st.scanning.lock() = false;
                    *st.cancel.lock() = None;
                }
                let _ = app.emit("scan-progress", &progress);
            }
            Err(err) => {
                let progress = ScanProgress {
                    phase: "error".into(),
                    message: err.to_string(),
                    scanned: 0,
                    skipped: 0,
                    files: 0,
                    current_folder: String::new(),
                };
                if let Some(st) = app.try_state::<AppState>() {
                    *st.last_progress.lock() = progress.clone();
                    *st.scanning.lock() = false;
                    *st.cancel.lock() = None;
                }
                let _ = app.emit("scan-progress", &progress);
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub fn cancel_scan(state: State<'_, AppState>) -> AppResult<()> {
    if let Some(flag) = state.cancel.lock().as_ref() {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
pub fn get_scan_progress(state: State<'_, AppState>) -> ScanProgress {
    state.last_progress.lock().clone()
}

#[tauri::command]
pub fn open_file(path: String) -> AppResult<()> {
    open_path(&path)
}

#[tauri::command]
pub fn open_playlist(items: Vec<PlaylistItem>) -> AppResult<String> {
    write_and_open_playlist(&items)
}

#[tauri::command]
pub fn pick_folder(app: AppHandle) -> AppResult<Option<String>> {
    let folder = app.dialog().file().blocking_pick_folder();
    Ok(folder.map(|p| {
        let path = p.into_path().unwrap_or_default();
        path_to_string(&path)
    }))
}

#[tauri::command]
pub fn pick_database_path(app: AppHandle) -> AppResult<Option<String>> {
    let file = app
        .dialog()
        .file()
        .add_filter("SQLite database", &["db", "sqlite", "sqlite3"])
        .set_file_name("file-index.db")
        .blocking_save_file();
    Ok(file.map(|p| {
        let path = p.into_path().unwrap_or_default();
        path_to_string(&path)
    }))
}

#[tauri::command]
pub fn export_settings(app: AppHandle, settings: AppSettings) -> AppResult<Option<String>> {
    let file = app
        .dialog()
        .file()
        .add_filter("JSON settings", &["json"])
        .set_file_name("lfe-settings.json")
        .blocking_save_file();
    let Some(picked) = file else {
        return Ok(None);
    };
    let path = picked.into_path().unwrap_or_default();
    settings::export_settings_to(&path, &settings)?;
    Ok(Some(path_to_string(&path)))
}

#[tauri::command]
pub fn import_settings(app: AppHandle) -> AppResult<Option<InitResponse>> {
    let file = app
        .dialog()
        .file()
        .add_filter("JSON settings", &["json"])
        .blocking_pick_file();
    let Some(picked) = file else {
        return Ok(None);
    };
    let path = picked.into_path().unwrap_or_default();
    let settings = settings::import_settings_from(&path)?;
    let resolved = paths::resolve_database_path(&settings)?;
    paths::ensure_parent_dir(&resolved)?;
    let catalog_count = CatalogDb::open()?.catalog_count().unwrap_or(0);
    Ok(Some(InitResponse {
        settings,
        catalog_count,
        data_dir: path_to_string(&paths::data_dir()?),
        resolved_database_path: path_to_string(&resolved),
    }))
}

#[tauri::command]
pub fn get_host_url() -> String {
    crate::host::host_url()
}
