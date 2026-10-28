use std::collections::HashSet;
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::Serialize;

use crate::db::CatalogDb;
use crate::models::{AppError, AppResult};
use crate::paths::path_to_string;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MovedPath {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveFilesResult {
    pub destination: String,
    pub moved: u32,
    pub skipped: u32,
    pub failed: Vec<String>,
    pub renames: Vec<MovedPath>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveProgress {
    pub phase: String,
    pub message: String,
    pub current: u64,
    pub total: u64,
    pub current_file: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<MoveFilesResult>,
}

/// Move each file into `destination`, keeping the file name. Name clashes get `name (2).ext`.
/// Honors `cancel` between files so the UI can stop a long bulk move.
pub fn move_files_to_dir(
    paths: &[String],
    destination: &str,
    cancel: Option<Arc<AtomicBool>>,
    on_progress: Option<&dyn Fn(MoveProgress)>,
) -> AppResult<MoveFilesResult> {
    let dest_dir = PathBuf::from(destination.trim());
    if destination.trim().is_empty() || !dest_dir.is_dir() {
        return Err(AppError::Message("Destination is not a folder".into()));
    }

    let work: Vec<String> = {
        let mut seen = HashSet::new();
        paths
            .iter()
            .map(|p| p.trim().to_string())
            .filter(|p| !p.is_empty() && seen.insert(p.clone()))
            .collect()
    };
    let total = work.len() as u64;

    let emit = |phase: &str, message: &str, current: u64, current_file: &str, result: Option<MoveFilesResult>| {
        if let Some(cb) = on_progress {
            cb(MoveProgress {
                phase: phase.into(),
                message: message.into(),
                current,
                total,
                current_file: current_file.into(),
                result,
            });
        }
    };

    emit("moving", "Starting…", 0, "", None);

    let db = CatalogDb::open()?;
    let mut moved = 0u32;
    let mut skipped = 0u32;
    let mut failed = Vec::new();
    let mut renames = Vec::new();

    for (index, path) in work.iter().enumerate() {
        if cancel
            .as_ref()
            .is_some_and(|c| c.load(Ordering::Relaxed))
        {
            let result = MoveFilesResult {
                destination: path_to_string(&dest_dir),
                moved,
                skipped,
                failed,
                renames,
            };
            emit(
                "cancelled",
                &format!("Stopped after moving {moved} file(s)"),
                index as u64,
                "",
                Some(result.clone()),
            );
            return Ok(result);
        }

        emit(
            "moving",
            &format!("Moving {} / {total}…", index + 1),
            index as u64,
            path,
            None,
        );

        let from_path = PathBuf::from(path);
        let Some(file_name) = from_path.file_name().map(|n| n.to_os_string()) else {
            failed.push(format!("{path}: missing file name"));
            continue;
        };

        let direct = dest_dir.join(&file_name);
        if same_path(&from_path, &direct) {
            skipped += 1;
            continue;
        }
        if !from_path.is_file() {
            failed.push(format!("{path}: not a file"));
            continue;
        }

        let target = match next_available(&dest_dir, &file_name) {
            Ok(path) => path,
            Err(err) => {
                failed.push(format!("{path}: {err}"));
                continue;
            }
        };

        if let Err(err) = relocate(&from_path, &target) {
            failed.push(format!("{path}: {err}"));
            continue;
        }

        let to = path_to_string(&target);
        if let Err(err) = db.relocate_file(path, &to) {
            failed.push(format!("{to}: moved, catalog not updated ({err})"));
        }
        renames.push(MovedPath {
            from: path.to_string(),
            to,
        });
        moved += 1;
    }

    if moved == 0 && skipped == 0 && failed.is_empty() {
        return Err(AppError::Message("No files to move".into()));
    }

    let result = MoveFilesResult {
        destination: path_to_string(&dest_dir),
        moved,
        skipped,
        failed,
        renames,
    };
    emit(
        "done",
        &format!("Moved {moved} file(s)"),
        total,
        "",
        Some(result.clone()),
    );
    Ok(result)
}

fn next_available(dir: &Path, file_name: &OsStr) -> AppResult<PathBuf> {
    let direct = dir.join(file_name);
    if !direct.exists() {
        return Ok(direct);
    }

    let parsed = Path::new(file_name);
    let stem = parsed.file_stem().unwrap_or(file_name);
    let ext = parsed.extension();
    for n in 2..10_000 {
        let mut name = std::ffi::OsString::from(stem);
        name.push(format!(" ({n})"));
        if let Some(ext) = ext {
            name.push(".");
            name.push(ext);
        }
        let candidate = dir.join(&name);
        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    Err(AppError::Message(format!(
        "no free name for {}",
        file_name.to_string_lossy()
    )))
}

fn relocate(from: &Path, to: &Path) -> std::io::Result<()> {
    if to.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "destination file already exists",
        ));
    }
    match fs::rename(from, to) {
        Ok(()) => Ok(()),
        Err(err) if is_cross_device(&err) => {
            fs::copy(from, to)?;
            if let Err(del_err) = fs::remove_file(from) {
                let _ = fs::remove_file(to);
                return Err(del_err);
            }
            Ok(())
        }
        Err(err) => Err(err),
    }
}

fn is_cross_device(err: &std::io::Error) -> bool {
    // Windows ERROR_NOT_SAME_DEVICE = 17, Unix EXDEV = 18.
    matches!(err.raw_os_error(), Some(17) | Some(18))
}

fn same_path(a: &Path, b: &Path) -> bool {
    norm_path(a) == norm_path(b)
}

fn norm_path(path: &Path) -> String {
    let mut out = path.to_string_lossy().replace('/', "\\");
    while out.ends_with('\\') {
        out.pop();
    }
    #[cfg(windows)]
    {
        out.make_ascii_lowercase();
    }
    out
}
