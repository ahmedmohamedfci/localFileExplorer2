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

pub type ProgressSink = Arc<dyn Fn(ScanProgress) + Send + Sync>;

pub fn run_scan(
    app: AppHandle,
    settings: &AppSettings,
    cancel: Arc<AtomicBool>,
) -> AppResult<ScanProgress> {
    let sink: ProgressSink = Arc::new(move |progress| {
        let _ = app.emit("scan-progress", &progress);
    });
    run_scan_with_sink(sink, settings, cancel)
}

pub fn run_scan_with_sink(
    sink: ProgressSink,
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
        sink(progress.clone());
        return Ok(progress);
    }

    let mut scanned = 0u64;
    let mut skipped = 0u64;
    let mut files = 0u64;

    emit(
        &sink,
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
            sink(progress.clone());
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
                sink(progress.clone());
                return Ok(progress);
            }

            if !entry.file_type().is_dir() {
                continue;
            }

            let folder = entry.path();
            let folder_str = path_to_string(folder);
            emit(
                &sink,
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
                // Folder listing unchanged — still refresh last-access (and mtime),
                // and fill any missing durations, without re-indexing the folder.
                let mut refreshed = 0u64;
                let mut filled = 0u64;
                for (path, meta) in &media_files {
                    let path_str = path_to_string(path);
                    if let Ok(Some(existing)) = db.get_file(&path_str) {
                        let mtime = meta
                            .modified()
                            .ok()
                            .map(system_time_secs)
                            .unwrap_or(existing.mtime);
                        let atime = meta
                            .accessed()
                            .ok()
                            .map(system_time_secs)
                            .unwrap_or(mtime);
                        let times_changed = (existing.atime - atime).abs() > 0.5
                            || (existing.mtime - mtime).abs() > 0.5;

                        let mut updated = existing;
                        let mut dirty = false;
                        if times_changed {
                            updated.atime = atime;
                            updated.mtime = mtime;
                            dirty = true;
                            refreshed += 1;
                        }
                        if updated.duration_ms.is_none() {
                            if let Some(ms) = probe_duration_ms(path) {
                                updated.duration_ms = Some(ms);
                                dirty = true;
                                filled += 1;
                            }
                        }
                        if dirty {
                            updated.indexed_at = now_secs();
                            let _ = db.upsert_file(&updated);
                            files += 1;
                        }
                    }
                }
                if refreshed == 0 && filled == 0 {
                    skipped += 1;
                } else {
                    let msg = if filled > 0 && refreshed > 0 {
                        format!("Updating metadata ({refreshed} access, {filled} duration)…")
                    } else if filled > 0 {
                        format!("Filling durations ({filled})…")
                    } else {
                        format!("Refreshing access times ({refreshed})…")
                    };
                    emit(
                        &sink,
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
                        &sink,
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
        message: "DB updated".into(),
        scanned,
        skipped,
        files: catalog,
        current_folder: String::new(),
    };
    sink(progress.clone());
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
    sink: &ProgressSink,
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
    sink(progress);
}

pub fn filter_and_sort_limited(
    files: Vec<FileRecord>,
    include_clauses: &[crate::models::PatternClause],
    ignore_clauses: &[crate::models::PatternClause],
    sort_field: &str,
    sort_dir: &str,
    discard_path: bool,
    limit: u32,
) -> AppResult<Vec<FileRecord>> {
    let includes = compile_clauses(include_clauses)?;
    let ignores = compile_clauses(ignore_clauses)?;

    // Keep only matches — never hand the full catalog to the UI.
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
            shuffle_records(&mut out, &mut state);
            // discard_path: cluster same file names together while keeping group order random
            if discard_path {
                cluster_by_file_name(&mut out, &mut state);
            }
        }
        field => {
            out.sort_by(|a, b| {
                let ord = compare_field(a, b, field, discard_path);
                if desc {
                    ord.reverse()
                } else {
                    ord
                }
            });
        }
    }

    if limit > 0 && (out.len() as u32) > limit {
        out.truncate(limit as usize);
    }

    Ok(out)
}

struct CompiledClause {
    positive: Vec<Regex>,
    negative: Vec<Regex>,
}

fn compile_clauses(clauses: &[crate::models::PatternClause]) -> AppResult<Vec<CompiledClause>> {
    let mut out = Vec::new();
    for clause in clauses {
        let mut positive = Vec::new();
        for term in &clause.terms {
            if term.trim().is_empty() {
                continue;
            }
            positive.push(Regex::new(term)?);
        }
        let mut negative = Vec::new();
        for term in &clause.not_terms {
            if term.trim().is_empty() {
                continue;
            }
            negative.push(Regex::new(term)?);
        }
        if !positive.is_empty() || !negative.is_empty() {
            out.push(CompiledClause { positive, negative });
        }
    }
    Ok(out)
}

fn clause_matches(clause: &CompiledClause, path: &str) -> bool {
    clause.positive.iter().all(|re| re.is_match(path))
        && clause.negative.iter().all(|re| !re.is_match(path))
}

fn shuffle_records(out: &mut [FileRecord], state: &mut u64) {
    for i in (1..out.len()).rev() {
        *state = state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1);
        let j = (*state >> 33) as usize % (i + 1);
        out.swap(i, j);
    }
}

/// Group files that share the same file name; shuffle group order; path-order within group.
fn cluster_by_file_name(out: &mut Vec<FileRecord>, state: &mut u64) {
    if out.len() <= 1 {
        return;
    }
    use std::collections::HashMap;
    let mut groups: HashMap<String, Vec<FileRecord>> = HashMap::new();
    let mut order: Vec<String> = Vec::new();
    for f in out.drain(..) {
        let key = file_name_of(&f.path);
        if !groups.contains_key(&key) {
            order.push(key.clone());
        }
        groups.entry(key).or_default().push(f);
    }
    shuffle_keys(&mut order, state);
    for key in order {
        let mut group = groups.remove(&key).unwrap_or_default();
        group.sort_by(|a, b| compare_paths(&a.path, &b.path));
        out.append(&mut group);
    }
}

fn shuffle_keys(keys: &mut [String], state: &mut u64) {
    for i in (1..keys.len()).rev() {
        *state = state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1);
        let j = (*state >> 33) as usize % (i + 1);
        keys.swap(i, j);
    }
}

fn compare_field(
    a: &FileRecord,
    b: &FileRecord,
    field: &str,
    discard_path: bool,
) -> std::cmp::Ordering {
    match field {
        "name" | "path" => compare_path_aware(&a.path, &b.path, discard_path),
        "ext" => a
            .ext
            .to_lowercase()
            .cmp(&b.ext.to_lowercase())
            .then_with(|| compare_path_aware(&a.path, &b.path, discard_path)),
        "sizeBytes" | "size" => a
            .size_bytes
            .cmp(&b.size_bytes)
            .then_with(|| compare_path_aware(&a.path, &b.path, discard_path)),
        "atime" => {
            cmp_f64(a.atime, b.atime).then_with(|| compare_path_aware(&a.path, &b.path, discard_path))
        }
        "mtime" => {
            cmp_f64(a.mtime, b.mtime).then_with(|| compare_path_aware(&a.path, &b.path, discard_path))
        }
        "birthtime" => cmp_f64(a.birthtime, b.birthtime)
            .then_with(|| compare_path_aware(&a.path, &b.path, discard_path)),
        "durationMs" | "duration" => cmp_f64(a.duration_ms.unwrap_or(0.0), b.duration_ms.unwrap_or(0.0))
            .then_with(|| compare_path_aware(&a.path, &b.path, discard_path)),
        "indexedAt" => cmp_f64(a.indexed_at, b.indexed_at)
            .then_with(|| compare_path_aware(&a.path, &b.path, discard_path)),
        _ => compare_path_aware(&a.path, &b.path, discard_path),
    }
}

/// Path-aware ordering used as primary for path/name sorts, or as a tiebreak:
/// - discard_path on → file name first (same names cluster), then full path
/// - discard_path off → parent directory first (same folder stays together), then name
fn compare_path_aware(a: &str, b: &str, discard_path: bool) -> std::cmp::Ordering {
    if discard_path {
        file_name_of(a)
            .cmp(&file_name_of(b))
            .then_with(|| compare_paths(a, b))
    } else {
        compare_parents(a, b)
            .then_with(|| file_name_of(a).cmp(&file_name_of(b)))
            .then_with(|| compare_paths(a, b))
    }
}

/// Hierarchical path compare: segment-by-segment, case-insensitive, \ and / treated equal.
fn compare_paths(a: &str, b: &str) -> std::cmp::Ordering {
    compare_segments(&path_segments(a), &path_segments(b))
}

fn compare_parents(a: &str, b: &str) -> std::cmp::Ordering {
    compare_segments(&parent_segments(a), &parent_segments(b))
}

fn compare_segments(a_parts: &[String], b_parts: &[String]) -> std::cmp::Ordering {
    for (ap, bp) in a_parts.iter().zip(b_parts.iter()) {
        match ap.cmp(bp) {
            std::cmp::Ordering::Equal => {}
            other => return other,
        }
    }
    a_parts.len().cmp(&b_parts.len())
}

fn path_segments(path: &str) -> Vec<String> {
    path.replace('\\', "/")
        .to_lowercase()
        .split('/')
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect()
}

fn parent_segments(path: &str) -> Vec<String> {
    let parts = path_segments(path);
    if parts.len() > 1 {
        parts[..parts.len() - 1].to_vec()
    } else {
        Vec::new()
    }
}

fn file_name_of(path: &str) -> String {
    path_segments(path).into_iter().next_back().unwrap_or_default()
}

fn cmp_f64(a: f64, b: f64) -> std::cmp::Ordering {
    a.partial_cmp(&b).unwrap_or(std::cmp::Ordering::Equal)
}

