use std::fs;
use std::path::Path;

use serde_json::{json, Value};

use crate::models::{AppResult, AppSettings};
use crate::paths::{self, path_to_string, settings_path};

pub fn load_settings() -> AppResult<AppSettings> {
    let path = settings_path()?;
    if !path.exists() {
        let mut defaults = AppSettings::default();
        // Persist an explicit default DB path so it's editable in the UI/JSON.
        defaults.database_path = path_to_string(&paths::default_database_path()?);
        save_settings(&defaults)?;
        return Ok(defaults);
    }

    let raw = fs::read_to_string(&path)?;
    let value: Value = serde_json::from_str(&raw)?;
    let mut settings = migrate_settings(value);
    if settings.database_path.trim().is_empty() {
        settings.database_path = path_to_string(&paths::default_database_path()?);
    }
    Ok(settings)
}

/// Load without creating defaults / rewriting (used by db_path resolution).
pub fn load_settings_raw() -> AppResult<AppSettings> {
    let path = settings_path()?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let raw = fs::read_to_string(&path)?;
    let value: Value = serde_json::from_str(&raw)?;
    Ok(migrate_settings(value))
}

pub fn save_settings(settings: &AppSettings) -> AppResult<()> {
    let path = settings_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(settings)?;
    fs::write(path, json)?;
    Ok(())
}

pub fn settings_from_json_str(raw: &str) -> AppResult<AppSettings> {
    let value: Value = serde_json::from_str(raw)?;
    Ok(migrate_settings(value))
}

pub fn export_settings_to(path: &Path, settings: &AppSettings) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(settings)?;
    fs::write(path, json)?;
    Ok(())
}

pub fn import_settings_from(path: &Path) -> AppResult<AppSettings> {
    let raw = fs::read_to_string(path)?;
    let mut settings = settings_from_json_str(&raw)?;
    settings.extensions = normalize_extensions(&settings.extensions);
    if settings.database_path.trim().is_empty() {
        settings.database_path = path_to_string(&paths::default_database_path()?);
    }
    save_settings(&settings)?;
    Ok(settings)
}

fn migrate_settings(mut value: Value) -> AppSettings {
    if let Some(obj) = value.as_object_mut() {
        if obj.contains_key("sortBySearch") && !obj.contains_key("splitBySearch") {
            let v = obj.remove("sortBySearch").unwrap_or(json!(false));
            obj.insert("splitBySearch".into(), v);
        }
        migrate_pattern_array(obj, "includeRegexes");
        migrate_pattern_array(obj, "ignoreRegexes");
        // Older field names
        if obj.contains_key("databasePath") {
            // already camelCase from serde / json
        } else if let Some(v) = obj.remove("dbPath").or_else(|| obj.remove("database_path")) {
            obj.insert("databasePath".into(), v);
        }
    }

    serde_json::from_value(value).unwrap_or_default()
}

fn migrate_pattern_array(obj: &mut serde_json::Map<String, Value>, key: &str) {
    let Some(arr) = obj.get(key).cloned() else {
        return;
    };
    let Some(items) = arr.as_array() else {
        return;
    };

    let migrated: Vec<Value> = items
        .iter()
        .map(|item| {
            if item.is_string() {
                json!({
                    "pattern": item.as_str().unwrap_or(""),
                    "enabled": true
                })
            } else {
                item.clone()
            }
        })
        .collect();
    obj.insert(key.into(), Value::Array(migrated));
}

pub fn normalize_extensions(exts: &[String]) -> Vec<String> {
    exts.iter()
        .map(|e| {
            let t = e.trim().to_lowercase();
            if t.is_empty() {
                t
            } else if t.starts_with('.') {
                t
            } else {
                format!(".{t}")
            }
        })
        .filter(|e| !e.is_empty())
        .collect()
}
