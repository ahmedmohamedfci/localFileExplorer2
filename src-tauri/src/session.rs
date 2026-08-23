use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use parking_lot::Mutex;
use uuid::Uuid;

use crate::models::{AppResult, AppSettings, InitResponse, ScanProgress};
use crate::paths::{self, path_to_string, with_session};
use crate::settings::{self, normalize_extensions};
use crate::state::AppState;

#[derive(Clone)]
pub struct SessionHandle {
    pub id: String,
    pub data_dir: PathBuf,
    pub settings_path: PathBuf,
    inner: Arc<SessionInner>,
}

struct SessionInner {
    scan: Arc<Mutex<AppState>>,
}

impl SessionHandle {
    pub fn scan_state(&self) -> Arc<Mutex<AppState>> {
        Arc::clone(&self.inner.scan)
    }

    pub fn with_paths<F, R>(&self, f: F) -> R
    where
        F: FnOnce() -> R,
    {
        with_session(self.data_dir.clone(), self.settings_path.clone(), f)
    }
}

pub struct SessionManager {
    sessions: Mutex<std::collections::HashMap<String, SessionHandle>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(std::collections::HashMap::new()),
        }
    }

    pub fn get(&self, id: &str) -> Option<SessionHandle> {
        self.sessions.lock().get(id).cloned()
    }

    pub fn create_from_settings(&self, mut settings: AppSettings) -> AppResult<(SessionHandle, InitResponse)> {
        settings.extensions = normalize_extensions(&settings.extensions);
        let id = Uuid::new_v4().to_string();
        let base = paths::data_dir()?.join("sessions").join(&id);
        std::fs::create_dir_all(&base)?;
        let settings_path = base.join("settings.json");
        settings::export_settings_to(&settings_path, &settings)?;

        let handle = SessionHandle {
            id: id.clone(),
            data_dir: base.clone(),
            settings_path: settings_path.clone(),
            inner: Arc::new(SessionInner {
                scan: Arc::new(Mutex::new(AppState::default())),
            }),
        };

        let init = handle.with_paths(|| build_init_response(&settings, &base))?;
        self.sessions.lock().insert(id, handle.clone());
        Ok((handle, init))
    }

    pub fn create_native_default(&self) -> AppResult<(SessionHandle, InitResponse)> {
        let settings = settings::load_settings()?;
        let data_dir = paths::data_dir()?;
        let settings_path = paths::settings_path()?;
        let id = Uuid::new_v4().to_string();

        let handle = SessionHandle {
            id: id.clone(),
            data_dir: data_dir.clone(),
            settings_path: settings_path.clone(),
            inner: Arc::new(SessionInner {
                scan: Arc::new(Mutex::new(AppState::default())),
            }),
        };

        let init = build_init_response(&settings, &data_dir)?;
        self.sessions.lock().insert(id, handle.clone());
        Ok((handle, init))
    }
}

fn build_init_response(settings: &AppSettings, data_dir: &PathBuf) -> AppResult<InitResponse> {
    let resolved = paths::resolve_database_path(settings)?;
    paths::ensure_parent_dir(&resolved)?;
    let catalog_count = crate::db::CatalogDb::open()?.catalog_count()?;
    Ok(InitResponse {
        settings: settings.clone(),
        catalog_count,
        data_dir: path_to_string(data_dir),
        resolved_database_path: path_to_string(&resolved),
    })
}

pub fn start_session_scan(session: &SessionHandle, mut settings: AppSettings) -> AppResult<()> {
    {
        let scan = session.scan_state();
        let scan_guard = scan.lock();
        let mut scanning = scan_guard.scanning.lock();
        if *scanning {
            return Err(crate::models::AppError::Message("Scan already running".into()));
        }
        *scanning = true;
    }
    settings.extensions = normalize_extensions(&settings.extensions);
    settings.database_path = settings.database_path.trim().to_string();
    if settings.database_path.is_empty() {
        settings.database_path = path_to_string(&paths::default_database_path()?);
    }

    session.with_paths(|| -> AppResult<()> {
        paths::ensure_parent_dir(&paths::resolve_database_path(&settings)?)?;
        settings::save_settings(&settings)?;
        Ok(())
    })?;

    let cancel = Arc::new(AtomicBool::new(false));
    {
        let scan = session.scan_state();
        let scan_guard = scan.lock();
        *scan_guard.cancel.lock() = Some(cancel.clone());
        *scan_guard.last_progress.lock() = ScanProgress {
            phase: "scanning".into(),
            message: "Scanning…".into(),
            scanned: 0,
            skipped: 0,
            files: 0,
            current_folder: String::new(),
        };
    }

    let session = session.clone();
    std::thread::spawn(move || {
        let scan_state = session.scan_state();
        let sink: crate::scan::ProgressSink = Arc::new(move |progress| {
            *scan_state.lock().last_progress.lock() = progress;
        });

        let result = session.with_paths(|| {
            crate::scan::run_scan_with_sink(sink, &settings, cancel)
        });

        let scan = session.scan_state();
        let scan_guard = scan.lock();
        match result {
            Ok(progress) => {
                *scan_guard.last_progress.lock() = progress;
            }
            Err(err) => {
                *scan_guard.last_progress.lock() = ScanProgress {
                    phase: "error".into(),
                    message: err.to_string(),
                    scanned: 0,
                    skipped: 0,
                    files: 0,
                    current_folder: String::new(),
                };
            }
        }
        *scan_guard.scanning.lock() = false;
        *scan_guard.cancel.lock() = None;
    });

    Ok(())
}

pub fn cancel_session_scan(session: &SessionHandle) {
    if let Some(flag) = session.scan_state().lock().cancel.lock().as_ref() {
        flag.store(true, Ordering::Relaxed);
    }
}

pub fn session_scan_progress(session: &SessionHandle) -> ScanProgress {
    session.scan_state().lock().last_progress.lock().clone()
}
