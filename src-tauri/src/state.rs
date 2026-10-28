use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use parking_lot::Mutex;

use crate::models::ScanProgress;

pub struct AppState {
    pub scanning: Mutex<bool>,
    pub cancel: Mutex<Option<Arc<AtomicBool>>>,
    pub last_progress: Mutex<ScanProgress>,
    pub moving: Mutex<bool>,
    pub move_cancel: Mutex<Option<Arc<AtomicBool>>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            scanning: Mutex::new(false),
            cancel: Mutex::new(None),
            last_progress: Mutex::new(ScanProgress {
                phase: "idle".into(),
                message: String::new(),
                scanned: 0,
                skipped: 0,
                files: 0,
                current_folder: String::new(),
            }),
            moving: Mutex::new(false),
            move_cancel: Mutex::new(None),
        }
    }
}
