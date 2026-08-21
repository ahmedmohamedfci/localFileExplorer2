use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use regex::Regex;
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

use crate::db::{now_secs, system_time_secs, CatalogDb};
use crate::duration::probe_duration_ms;
use crate::models::{AppError, AppResult, AppSettings, FileRecord, ScanProgress};
use crate::paths::path_to_string;
use crate::settings::normalize_extensions;

pub fn run_scan(
    app: AppHandle,
    settings: &AppSettings,
    cancel: Arc<AtomicBool>,
) -> AppResult<ScanProgress> {
    let db = CatalogDb::open()?;
    let extensions: HashSet<String> = normalize_extensions(&settings.extensions)
        .into_iter()
        .collect();

    if settings.roots.is_empty() {
        let progress = ScanProgress {
            phase: "error".into(),
            message: "No roots configured".into(),
            scanned: 0,
            skipped: 0,
            files: db.catalog_count()? as u64,
            current_folder: String::new(),
        };
        let _ = app.emit("scan-progress", &progress);
        return Ok(progress);
    }

    let mut scanned = 0u64;
    let mut skipped = 0u64;
    let mut files = 0u64;

    emit(
        &app,
        "scanning",
        "Scanning…",
        scanned,
        skipped,
        files,
        "",
    );

    db.begin_immediate()?;

    for root in &settings.roots {
        if cancel.load(Ordering::Relaxed) {
            db.rollback()?;
            let progress = ScanProgress {
                phase: "idle".into(),
                message: "Scan cancelled".into(),
                scanned,
                skipped,
                files: db.catalog_count().unwrap_or(0) as u64,
                current_folder: String::new(),
            };
            let _ = app.emit("scan-progress", &progress);
            return Ok(progress);
        }

        let root_path = PathBuf::from(root);
        if !root_path.is_dir() {
            continue;
        }

        for entry in WalkDir::new(&root_path)
            .follow_links(false)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            if cancel.load(Ordering::Relaxed) {
                db.rollback()?;
                let progress = ScanProgress {
                    phase: "idle".into(),
                    message: "Scan cancelled".into(),
                    scanned,
                    skipped,
                    files: db.catalog_count().unwrap_or(0) as u64,
                    current_folder: String::new(),
                };
                let _ = app.emit("scan-progress", &progress);
                return Ok(progress);
            }

            if !entry.file_type().is_dir() {
                continue;
            }

            let folder = entry.path();
            let folder_str = path_to_string(folder);
            emit(
                &app,
                "scanning",
                "Scanning…",
                scanned,
                skipped,
                files,
                &folder_str,
            );

            let (file_count, child_folder_count, total_bytes, listing_hash, media_files) =
                match read_folder_snapshot(folder, &extensions) {
                    Ok(v) => v,
                    Err(_) => continue,
                };

            scanned += 1;

            let unchanged = !settings.deep_scan
                && db
                    .get_folder_stats(&folder_str)
                    .ok()
                    .flatten()
                    .map(|st| {
                        st.file_count == file_count
                            && st.child_folder_count == child_folder_count
                            && st.total_file_bytes == total_bytes
                            && st.listing_hash == listing_hash
                    })
                    .unwrap_or(false);

            if unchanged {
                // Still fill missing durations without re-walking file content indexes.
                let mut filled = 0u64;
                for (path, _meta) in &media_files {
                    let path_str = path_to_string(path);
                    if let Ok(Some(existing)) = db.get_file(&path_str) {
                        if existing.duration_ms.is_none() {
                            if let Some(ms) = probe_duration_ms(path) {
                                let mut updated = existing;
                                updated.duration_ms = Some(ms);
                                updated.indexed_at = now_secs();
                                let _ = db.upsert_file(&updated);
                                filled += 1;
                                files += 1;
                            }
                        }
                    }
                }
                if filled == 0 {
                    skipped += 1;
                } else {
                    let msg = format!("Filling durations ({filled})…");
                    emit(
                        &app,
                        "scanning",
                        &msg,
                        scanned,
                        skipped,
                        files,
                        &folder_str,
                    );
                }
                continue;
            }

            let parent = folder
                .parent()
                .map(path_to_string)
                .filter(|p| !p.is_empty());

            // Prior catalog rows in this folder — used to carry duration across renames
            // (same size + mtime, new name) without re-probing.
            let prior = db.files_in_folder(&folder_str).unwrap_or_default();
            let mut duration_by_identity: std::collections::HashMap<(i64, i64), Option<f64>> =
                std::collections::HashMap::new();
            for old in &prior {
                let key = (old.size_bytes, (old.mtime * 1000.0).round() as i64);
                duration_by_identity
                    .entry(key)
                    .or_insert(old.duration_ms);
            }

            db.upsert_folder(
                &folder_str,
                parent.as_deref(),
                file_count,
                child_folder_count,
                total_bytes,
                &listing_hash,
            )?;

            let mut seen_paths = HashSet::new();

            for (path, meta) in media_files {
                let path_str = path_to_string(&path);
                seen_paths.insert(path_str.clone());
                let ext = path
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|e| format!(".{}", e.to_lowercase()))
                    .unwrap_or_default();

                let existing = db.get_file(&path_str).ok().flatten();
                let size_bytes = meta.len() as i64;
                let mtime = meta.modified().ok().map(system_time_secs).unwrap_or(0.0);
                let atime = meta.accessed().ok().map(system_time_secs).unwrap_or(mtime);
                let birthtime = meta.created().ok().map(system_time_secs).unwrap_or(mtime);
                let identity = (size_bytes, (mtime * 1000.0).round() as i64);

                let carried = duration_by_identity.get(&identity).copied().flatten();
                let existing_duration = existing.as_ref().and_then(|e| e.duration_ms);

                let content_changed = existing
                    .as_ref()
                    .map(|e| e.size_bytes != size_bytes || (e.mtime - mtime).abs() > 0.5)
                    .unwrap_or(true);

                let duration_ms = if !content_changed && existing_duration.is_some() {
                    existing_duration
                } else if let Some(ms) = carried {
                    Some(ms)
                } else if content_changed || existing_duration.is_none() {
                    probe_duration_ms(&path).or(existing_duration)
                } else {
                    existing_duration
                };

                let record = FileRecord {
                    path: path_str,
                    ext,
                    size_bytes,
                    atime,
                    mtime,
                    birthtime,
                    duration_ms,
                    indexed_at: now_secs(),
                };
                db.upsert_file(&record)?;
                files += 1;

                if files % 25 == 0 {
                    emit(
                        &app,
                        "scanning",
                        "Scanning…",
                        scanned,
                        skipped,
                        files,
                        &folder_str,
                    );
                }
            }

            // Drop catalog entries for files renamed/removed from this folder
            for old in prior {
                if !seen_paths.contains(&old.path) {
                    let _ = db.delete_file(&old.path);
                }
            }
        }
    }

    let _ = db.delete_missing_under_roots(&settings.roots);
    db.commit()?;

    let catalog = db.catalog_count()? as u64;
    let progress = ScanProgress {
        phase: "done".into(),
        message: "Scan complete".into(),
        scanned,
        skipped,
        files: catalog,
        current_folder: String::new(),
    };
    let _ = app.emit("scan-progress", &progress);
    Ok(progress)
}

fn read_folder_snapshot(
    folder: &Path,
    extensions: &HashSet<String>,
) -> AppResult<(i64, i64, i64, String, Vec<(PathBuf, fs::Metadata)>)> {
    let mut file_count = 0i64;
    let mut child_folder_count = 0i64;
    let mut total_bytes = 0i64;
    let mut media_files = Vec::new();
    // name + size for every file — detects renames even when counts/bytes match
    let mut listing_parts: Vec<String> = Vec::new();

    let entries = fs::read_dir(folder).map_err(AppError::Io)?;
    for entry in entries.flatten() {
        let path = entry.path();
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };

        if meta.is_dir() {
            child_folder_count += 1;
            continue;
        }
        if !meta.is_file() {
            continue;
        }

        file_count += 1;
        total_bytes += meta.len() as i64;
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        listing_parts.push(format!("{name}\0{}", meta.len()));

        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| format!(".{}", e.to_lowercase()))
            .unwrap_or_default();
        if extensions.contains(&ext) {
            media_files.push((path, meta));
        }
    }

    listing_parts.sort();
    let listing_hash = fnv1a64(listing_parts.join("\n").as_bytes());

    Ok((
        file_count,
        child_folder_count,
        total_bytes,
        listing_hash,
        media_files,
    ))
}

fn fnv1a64(data: &[u8]) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in data {
        hash ^= u64::from(*b);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

fn emit(
    app: &AppHandle,
    phase: &str,
    message: &str,
    scanned: u64,
    skipped: u64,
    files: u64,
    current_folder: &str,
) {
    let progress = ScanProgress {
        phase: phase.into(),
        message: message.into(),
        scanned,
        skipped,
        files,
        current_folder: current_folder.into(),
    };
    let _ = app.emit("scan-progress", &progress);
}

pub fn filter_and_sort(
    files: Vec<FileRecord>,
    include_clauses: &[crate::models::PatternClause],
    ignore_clauses: &[crate::models::PatternClause],
    sort_field: &str,
    sort_dir: &str,
) -> AppResult<Vec<FileRecord>> {
    let includes = compile_clauses(include_clauses)?;
    let ignores = compile_clauses(ignore_clauses)?;

    let mut out: Vec<FileRecord> = files
        .into_iter()
        .filter(|f| {
            let path = &f.path;
            let include_ok = includes.is_empty() || includes.iter().any(|c| clause_matches(c, path));
            if !include_ok {
                return false;
            }
            let ignored = ignores.iter().any(|c| clause_matches(c, path));
            !ignored
        })
        .collect();

    let desc = sort_dir.eq_ignore_ascii_case("desc");
    match sort_field {
        "random" => {
            let mut state =
                now_secs().to_bits() ^ (out.len() as u64).wrapping_mul(0x9e3779b97f4a7c15);
            for i in (1..out.len()).rev() {
                state = state
                    .wrapping_mul(6364136223846793005)
                    .wrapping_add(1);
                let j = (state >> 33) as usize % (i + 1);
                out.swap(i, j);
            }
        }
        field => {
            out.sort_by(|a, b| {
                let ord = compare_field(a, b, field);
                if desc {
                    ord.reverse()
                } else {
                    ord
                }
            });
        }
    }

    Ok(out)
}

fn compile_clauses(clauses: &[crate::models::PatternClause]) -> AppResult<Vec<Vec<Regex>>> {
    let mut out = Vec::new();
    for clause in clauses {
        let mut terms = Vec::new();
        for term in &clause.terms {
            if term.trim().is_empty() {
                continue;
            }
            terms.push(Regex::new(term)?);
        }
        if !terms.is_empty() {
            out.push(terms);
        }
    }
    Ok(out)
}

fn clause_matches(terms: &[Regex], path: &str) -> bool {
    terms.iter().all(|re| re.is_match(path))
}

fn compare_field(a: &FileRecord, b: &FileRecord, field: &str) -> std::cmp::Ordering {
    match field {
        "ext" => a.ext.to_lowercase().cmp(&b.ext.to_lowercase()).then_with(|| {
            a.path.to_lowercase().cmp(&b.path.to_lowercase())
        }),
        "sizeBytes" | "size" => a.size_bytes.cmp(&b.size_bytes).then_with(|| {
            a.path.to_lowercase().cmp(&b.path.to_lowercase())
        }),
        "atime" => cmp_f64(a.atime, b.atime).then_with(|| {
            a.path.to_lowercase().cmp(&b.path.to_lowercase())
        }),
        "mtime" => cmp_f64(a.mtime, b.mtime).then_with(|| {
            a.path.to_lowercase().cmp(&b.path.to_lowercase())
        }),
        "birthtime" => cmp_f64(a.birthtime, b.birthtime).then_with(|| {
            a.path.to_lowercase().cmp(&b.path.to_lowercase())
        }),
        "durationMs" | "duration" => cmp_opt_f64(a.duration_ms, b.duration_ms).then_with(|| {
            a.path.to_lowercase().cmp(&b.path.to_lowercase())
        }),
        "indexedAt" => cmp_f64(a.indexed_at, b.indexed_at).then_with(|| {
            a.path.to_lowercase().cmp(&b.path.to_lowercase())
        }),
        _ => a.path.to_lowercase().cmp(&b.path.to_lowercase()),
    }
}

fn cmp_f64(a: f64, b: f64) -> std::cmp::Ordering {
    a.partial_cmp(&b).unwrap_or(std::cmp::Ordering::Equal)
}

fn cmp_opt_f64(a: Option<f64>, b: Option<f64>) -> std::cmp::Ordering {
    match (a, b) {
        (Some(x), Some(y)) => cmp_f64(x, y),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => std::cmp::Ordering::Equal,
    }
}
