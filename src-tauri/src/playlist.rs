use std::fs;
use std::path::PathBuf;
use std::process::Command;

use crate::models::{AppError, AppResult, PlaylistItem};
use crate::paths::playlist_path;

pub fn clear_playlist() -> AppResult<()> {
    let path = playlist_path()?;
    if path.exists() {
        fs::remove_file(&path)?;
    }
    Ok(())
}

pub fn write_and_open_playlist(items: &[PlaylistItem]) -> AppResult<String> {
    if items.is_empty() {
        return Err(AppError::Message("Results list is empty".into()));
    }

    let path = playlist_path()?;
    let mut body = String::from("MPCPLAYLIST\n");
    for (i, item) in items.iter().enumerate() {
        let n = i + 1;
        let entry_type = if item.is_delimiter { 1 } else { 0 };
        body.push_str(&format!("{n},type,{entry_type}\n"));
        body.push_str(&format!("{n},filename,{}\n", item.path));
    }
    fs::write(&path, body)?;

    open_with_mpc(&path)?;
    Ok(path.to_string_lossy().into_owned())
}

pub fn open_path(path: &str) -> AppResult<()> {
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", "", path])
            .spawn()
            .map_err(|e| AppError::Message(format!("Failed to open file: {e}")))?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| AppError::Message(format!("Failed to open file: {e}")))?;
        return Ok(());
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| AppError::Message(format!("Failed to open file: {e}")))?;
        Ok(())
    }
}

fn open_with_mpc(playlist: &PathBuf) -> AppResult<()> {
    let candidates = [
        "mpc-hc64.exe",
        "mpc-hc.exe",
        "mpc-be64.exe",
        "mpc-be.exe",
        "MPC-HC64.exe",
        "MPC-HC.exe",
        "MPC-BE64.exe",
        "MPC-BE.exe",
    ];

    for name in candidates {
        if let Ok(status) = Command::new(name).arg(playlist).spawn() {
            drop(status);
            return Ok(());
        }
    }

    // Fall back to OS association for .mpcpl
    open_path(&playlist.to_string_lossy())
}
