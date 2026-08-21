use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};

use crate::models::{AppResult, FileRecord};
use crate::paths::db_path;

pub struct CatalogDb {
    conn: Connection,
}

#[derive(Debug, Clone)]
pub struct FolderStats {
    pub file_count: i64,
    pub child_folder_count: i64,
    pub total_file_bytes: i64,
    pub listing_hash: String,
}

impl CatalogDb {
    pub fn open() -> AppResult<Self> {
        let path = db_path()?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA temp_store = MEMORY;
            ",
        )?;
        let db = Self { conn };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> AppResult<()> {
        self.conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS settings (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS folders (
              path TEXT PRIMARY KEY,
              parentPath TEXT,
              fileCount INTEGER NOT NULL DEFAULT 0,
              childFolderCount INTEGER NOT NULL DEFAULT 0,
              totalFileBytes INTEGER NOT NULL DEFAULT 0,
              subtreeBytes INTEGER,
              listingHash TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS files (
              path TEXT PRIMARY KEY,
              ext TEXT NOT NULL,
              sizeBytes INTEGER NOT NULL,
              atime REAL NOT NULL,
              mtime REAL NOT NULL,
              birthtime REAL NOT NULL,
              durationMs REAL,
              indexedAt REAL NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_files_ext ON files(ext);
            CREATE INDEX IF NOT EXISTS idx_files_size ON files(sizeBytes);
            CREATE INDEX IF NOT EXISTS idx_files_mtime ON files(mtime);
            CREATE INDEX IF NOT EXISTS idx_files_duration ON files(durationMs);
            CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parentPath);
            ",
        )?;

        // Older DBs may lack listingHash
        let has_hash: bool = self
            .conn
            .prepare("PRAGMA table_info(folders)")?
            .query_map([], |r| r.get::<_, String>(1))?
            .filter_map(|c| c.ok())
            .any(|name| name == "listingHash");
        if !has_hash {
            self.conn
                .execute(
                    "ALTER TABLE folders ADD COLUMN listingHash TEXT NOT NULL DEFAULT ''",
                    [],
                )?;
        }

        Ok(())
    }

    pub fn catalog_count(&self) -> AppResult<i64> {
        let count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM files", [], |r| r.get(0))?;
        Ok(count)
    }

    pub fn get_folder_stats(&self, path: &str) -> AppResult<Option<FolderStats>> {
        let row = self
            .conn
            .query_row(
                "SELECT fileCount, childFolderCount, totalFileBytes, listingHash
                 FROM folders WHERE path = ?1",
                params![path],
                |r| {
                    Ok(FolderStats {
                        file_count: r.get(0)?,
                        child_folder_count: r.get(1)?,
                        total_file_bytes: r.get(2)?,
                        listing_hash: r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                    })
                },
            )
            .optional()?;
        Ok(row)
    }

    pub fn upsert_folder(
        &self,
        path: &str,
        parent_path: Option<&str>,
        file_count: i64,
        child_folder_count: i64,
        total_file_bytes: i64,
        listing_hash: &str,
    ) -> AppResult<()> {
        self.conn.execute(
            "INSERT INTO folders(path, parentPath, fileCount, childFolderCount, totalFileBytes, subtreeBytes, listingHash)
             VALUES(?1, ?2, ?3, ?4, ?5, NULL, ?6)
             ON CONFLICT(path) DO UPDATE SET
               parentPath=excluded.parentPath,
               fileCount=excluded.fileCount,
               childFolderCount=excluded.childFolderCount,
               totalFileBytes=excluded.totalFileBytes,
               listingHash=excluded.listingHash",
            params![
                path,
                parent_path,
                file_count,
                child_folder_count,
                total_file_bytes,
                listing_hash
            ],
        )?;
        Ok(())
    }

    pub fn get_file(&self, path: &str) -> AppResult<Option<FileRecord>> {
        let row = self
            .conn
            .query_row(
                "SELECT path, ext, sizeBytes, atime, mtime, birthtime, durationMs, indexedAt
                 FROM files WHERE path = ?1",
                params![path],
                map_file_row,
            )
            .optional()?;
        Ok(row)
    }

    /// Files whose path is directly under `folder` (no deeper children).
    pub fn files_in_folder(&self, folder: &str) -> AppResult<Vec<FileRecord>> {
        let mut base = folder.trim_end_matches(['\\', '/']).to_string();
        let prefix_bs = format!("{base}\\");
        let prefix_slash = format!("{base}/");

        let mut stmt = self.conn.prepare(
            "SELECT path, ext, sizeBytes, atime, mtime, birthtime, durationMs, indexedAt
             FROM files WHERE path LIKE ?1 OR path LIKE ?2",
        )?;
        let rows = stmt.query_map(
            params![format!("{prefix_bs}%"), format!("{prefix_slash}%")],
            map_file_row,
        )?;

        let mut out = Vec::new();
        for row in rows {
            let file = row?;
            let rest = if file.path.starts_with(&prefix_bs) {
                &file.path[prefix_bs.len()..]
            } else if file.path.starts_with(&prefix_slash) {
                &file.path[prefix_slash.len()..]
            } else {
                continue;
            };
            if !rest.is_empty() && !rest.contains('\\') && !rest.contains('/') {
                out.push(file);
            }
        }
        Ok(out)
    }

    pub fn delete_file(&self, path: &str) -> AppResult<()> {
        self.conn
            .execute("DELETE FROM files WHERE path = ?1", params![path])?;
        Ok(())
    }

    pub fn upsert_file(&self, file: &FileRecord) -> AppResult<()> {
        self.conn.execute(
            "INSERT INTO files(path, ext, sizeBytes, atime, mtime, birthtime, durationMs, indexedAt)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(path) DO UPDATE SET
               ext=excluded.ext,
               sizeBytes=excluded.sizeBytes,
               atime=excluded.atime,
               mtime=excluded.mtime,
               birthtime=excluded.birthtime,
               durationMs=COALESCE(excluded.durationMs, files.durationMs),
               indexedAt=excluded.indexedAt",
            params![
                file.path,
                file.ext,
                file.size_bytes,
                file.atime,
                file.mtime,
                file.birthtime,
                file.duration_ms,
                file.indexed_at,
            ],
        )?;
        Ok(())
    }

    pub fn delete_missing_under_roots(&self, roots: &[String]) -> AppResult<u64> {
        if roots.is_empty() {
            let deleted = self.conn.execute("DELETE FROM files", [])? as u64;
            let _ = self.conn.execute("DELETE FROM folders", [])?;
            return Ok(deleted);
        }

        let mut deleted = 0u64;
        let paths: Vec<String> = {
            let mut stmt = self.conn.prepare("SELECT path FROM files")?;
            let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
            rows.filter_map(|r| r.ok()).collect()
        };

        for path in paths {
            let under_root = roots.iter().any(|root| path_under_root(&path, root));
            if !under_root || !Path::new(&path).exists() {
                deleted += self
                    .conn
                    .execute("DELETE FROM files WHERE path = ?1", params![path])?
                    as u64;
            }
        }

        let folder_paths: Vec<String> = {
            let mut stmt = self.conn.prepare("SELECT path FROM folders")?;
            let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
            rows.filter_map(|r| r.ok()).collect()
        };
        for path in folder_paths {
            let under_root = roots.iter().any(|root| path_under_root(&path, root));
            if !under_root || !Path::new(&path).is_dir() {
                let _ = self
                    .conn
                    .execute("DELETE FROM folders WHERE path = ?1", params![path])?;
            }
        }

        Ok(deleted)
    }

    pub fn query_all(&self) -> AppResult<Vec<FileRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT path, ext, sizeBytes, atime, mtime, birthtime, durationMs, indexedAt FROM files",
        )?;
        let rows = stmt.query_map([], map_file_row)?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub fn begin_immediate(&self) -> AppResult<()> {
        self.conn.execute_batch("BEGIN IMMEDIATE")?;
        Ok(())
    }

    pub fn commit(&self) -> AppResult<()> {
        self.conn.execute_batch("COMMIT")?;
        Ok(())
    }

    pub fn rollback(&self) -> AppResult<()> {
        let _ = self.conn.execute_batch("ROLLBACK");
        Ok(())
    }
}

fn map_file_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<FileRecord> {
    Ok(FileRecord {
        path: r.get(0)?,
        ext: r.get(1)?,
        size_bytes: r.get(2)?,
        atime: r.get(3)?,
        mtime: r.get(4)?,
        birthtime: r.get(5)?,
        duration_ms: r.get(6)?,
        indexed_at: r.get(7)?,
    })
}

fn path_under_root(path: &str, root: &str) -> bool {
    let p = normalize_cmp(path);
    let r = normalize_cmp(root);
    p == r || p.starts_with(&(r.clone() + "\\")) || p.starts_with(&(r + "/"))
}

fn normalize_cmp(s: &str) -> String {
    let mut out = s.replace('/', "\\").to_lowercase();
    while out.ends_with('\\') {
        out.pop();
    }
    out
}

pub fn system_time_secs(t: SystemTime) -> f64 {
    t.duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

pub fn now_secs() -> f64 {
    system_time_secs(SystemTime::now())
}
