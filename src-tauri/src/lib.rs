mod commands;
mod db;
mod duration;
mod models;
mod paths;
mod playlist;
mod scan;
mod settings;
mod state;

use std::sync::atomic::Ordering;
use std::time::Duration;

use state::AppState;
use tauri::{Manager, RunEvent, WindowEvent};

fn request_shutdown(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        if let Some(flag) = state.cancel.lock().as_ref() {
            flag.store(true, Ordering::SeqCst);
        }
        *state.scanning.lock() = false;
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Apply --settings / --data-dir (or LFE_SETTINGS / LFE_DATA_DIR) before UI init.
    let _ = paths::init_from_cli_and_env();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::init_app,
            commands::get_settings,
            commands::save_settings,
            commands::get_catalog_count,
            commands::get_resolved_database_path,
            commands::query_files,
            commands::start_scan,
            commands::cancel_scan,
            commands::get_scan_progress,
            commands::open_file,
            commands::open_playlist,
            commands::pick_folder,
            commands::pick_database_path,
            commands::export_settings,
            commands::import_settings,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| match event {
            RunEvent::WindowEvent { label, event, .. } => {
                if label == "main" {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        // Cancel background scan, then force a full process exit so
                        // non-joinable scan threads cannot keep the process alive.
                        api.prevent_close();
                        request_shutdown(&app_handle);
                        let handle = app_handle.clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(Duration::from_millis(150));
                            handle.exit(0);
                            std::thread::sleep(Duration::from_millis(400));
                            std::process::exit(0);
                        });
                    }
                }
            }
            RunEvent::ExitRequested { .. } => {
                request_shutdown(&app_handle);
            }
            RunEvent::Exit => {
                request_shutdown(&app_handle);
                // Hard-exit: Rust non-daemon threads (scan) would otherwise hang the process.
                std::process::exit(0);
            }
            _ => {}
        });
}
