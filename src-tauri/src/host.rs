use std::io::Read;
use std::sync::{Arc, OnceLock};

use rust_embed::RustEmbed;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tiny_http::{Header, Method, Response, Server, StatusCode};

use crate::db::CatalogDb;
use crate::models::{AppError, AppResult, AppSettings, InitResponse, PlaylistItem, QueryRequest};
use crate::paths::{self, path_to_string};
use crate::playlist::{open_path, write_and_open_playlist};
use crate::scan::filter_and_sort;
use crate::session::{
    cancel_session_scan, session_scan_progress, start_session_scan, SessionManager,
};
use crate::settings::{self, normalize_extensions};

pub const HOST_ADDR: &str = "127.0.0.1";
/// Preferred first port; if taken (another app instance), try the next ones.
pub const HOST_PORT_START: u16 = 666;
const HOST_PORT_ATTEMPTS: u16 = 32;

static BOUND_PORT: OnceLock<u16> = OnceLock::new();

#[derive(RustEmbed)]
#[folder = "../dist/"]
struct DistAssets;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InitSessionBody {
    settings: AppSettings,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InitSessionResponse {
    session_id: String,
    #[serde(flatten)]
    init: InitResponse,
}

#[derive(Debug, Serialize)]
struct HostInfo {
    url: String,
    port: u16,
}

pub fn host_url() -> String {
    let port = BOUND_PORT.get().copied().unwrap_or(HOST_PORT_START);
    format!("http://{HOST_ADDR}:{port}/")
}

pub fn bound_port() -> Option<u16> {
    BOUND_PORT.get().copied()
}

pub fn start(sessions: Arc<SessionManager>) {
    std::thread::spawn(move || {
        if let Err(err) = run_server(sessions) {
            eprintln!("localhost host stopped: {err}");
        }
    });
}

fn bind_server() -> AppResult<(Server, u16)> {
    let mut last_err = String::new();
    for offset in 0..HOST_PORT_ATTEMPTS {
        let port = HOST_PORT_START.saturating_add(offset);
        let addr = format!("{HOST_ADDR}:{port}");
        match Server::http(&addr) {
            Ok(server) => {
                let _ = BOUND_PORT.set(port);
                return Ok((server, port));
            }
            Err(e) => last_err = format!("{addr}: {e}"),
        }
    }
    Err(AppError::Message(format!(
        "Cannot bind browser host on ports {HOST_PORT_START}–{} ({last_err})",
        HOST_PORT_START + HOST_PORT_ATTEMPTS - 1
    )))
}

fn run_server(sessions: Arc<SessionManager>) -> AppResult<()> {
    let (server, port) = bind_server()?;
    eprintln!("Local File Explorer host listening on {}", host_url());

    for mut request in server.incoming_requests() {
        let method = request.method().clone();
        let path = request.url().split('?').next().unwrap_or("/").to_string();
        let session_id = header_value(request.headers(), "X-Session-Id");

        let mut body = Vec::new();
        if method == Method::Post {
            let _ = request.as_reader().read_to_end(&mut body);
        }

        let response = match (method, path.as_str()) {
            (Method::Get, "/api/host/info") => json_response(StatusCode(200), &HostInfo {
                url: host_url(),
                port,
            }),
            (Method::Get, "/api/default-settings") => {
                match settings::load_settings() {
                    Ok(s) => json_response(StatusCode(200), &s),
                    Err(e) => error_response(StatusCode(500), &e),
                }
            }
            (Method::Post, "/api/session/init") => match serde_json::from_slice::<InitSessionBody>(&body) {
                Ok(payload) => match sessions.create_from_settings(payload.settings) {
                    Ok((handle, init)) => json_response(
                        StatusCode(200),
                        &InitSessionResponse {
                            session_id: handle.id,
                            init,
                        },
                    ),
                    Err(e) => error_response(StatusCode(500), &e),
                },
                Err(e) => error_response(StatusCode(400), &AppError::Json(e)),
            },
            (Method::Post, "/api/session/default") => match sessions.create_native_default() {
                Ok((handle, init)) => json_response(
                    StatusCode(200),
                    &InitSessionResponse {
                        session_id: handle.id,
                        init,
                    },
                ),
                Err(e) => error_response(StatusCode(500), &e),
            },
            (Method::Post, "/api/settings/save") => with_session_route(&sessions, session_id, |session| {
                let settings: AppSettings = parse_json_body(&body)?;
                session.with_paths(|| {
                    let mut settings = settings;
                    settings.extensions = normalize_extensions(&settings.extensions);
                    settings.database_path = settings.database_path.trim().to_string();
                    if settings.database_path.is_empty() {
                        settings.database_path = path_to_string(&paths::default_database_path()?);
                    }
                    paths::ensure_parent_dir(&paths::resolve_database_path(&settings)?)?;
                    settings::save_settings(&settings)?;
                    Ok(settings)
                })
            }),
            (Method::Get, "/api/catalog/count") => with_session_route(&sessions, session_id, |session| {
                session.with_paths(|| CatalogDb::open()?.catalog_count())
            }),
            (Method::Post, "/api/query") => with_session_route(&sessions, session_id, |session| {
                let request: QueryRequest = parse_json_body(&body)?;
                session.with_paths(|| {
                    let files = CatalogDb::open()?.query_all()?;
                    filter_and_sort(
                        files,
                        &request.include_clauses,
                        &request.ignore_clauses,
                        &request.sort_field,
                        &request.sort_dir,
                    )
                })
            }),
            (Method::Post, "/api/scan/start") => with_session_route(&sessions, session_id, |session| {
                let settings: AppSettings = parse_json_body(&body)?;
                start_session_scan(session, settings)?;
                Ok(json!({ "ok": true }))
            }),
            (Method::Post, "/api/scan/cancel") => with_session_route(&sessions, session_id, |session| {
                cancel_session_scan(session);
                Ok(json!({ "ok": true }))
            }),
            (Method::Get, "/api/scan/progress") => with_session_route(&sessions, session_id, |session| {
                Ok(session_scan_progress(session))
            }),
            (Method::Post, "/api/open/file") => {
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase")]
                struct Body { path: String }
                match serde_json::from_slice::<Body>(&body) {
                    Ok(payload) => match open_path(&payload.path) {
                        Ok(()) => json_response(StatusCode(200), &json!({ "ok": true })),
                        Err(e) => error_response(StatusCode(500), &e),
                    },
                    Err(e) => error_response(StatusCode(400), &AppError::Json(e)),
                }
            }
            (Method::Post, "/api/open/playlist") => with_session_route(&sessions, session_id, |session| {
                let items: Vec<PlaylistItem> = parse_json_body(&body)?;
                session.with_paths(|| {
                    let path = write_and_open_playlist(&items)?;
                    Ok(json!({ "path": path }))
                })
            }),
            (Method::Post, "/api/dialog/pick-folder") => {
                let path = rfd::FileDialog::new()
                    .pick_folder()
                    .map(|p| path_to_string(&p));
                json_response(StatusCode(200), &path)
            }
            (Method::Post, "/api/dialog/pick-database") => {
                let path = rfd::FileDialog::new()
                    .add_filter("SQLite database", &["db", "sqlite", "sqlite3"])
                    .set_file_name("file-index.db")
                    .save_file()
                    .map(|p| path_to_string(&p));
                json_response(StatusCode(200), &path)
            }
            (Method::Post, "/api/dialog/import-settings") => with_session_route(&sessions, session_id, |session| {
                let Some(path) = rfd::FileDialog::new()
                    .add_filter("JSON settings", &["json"])
                    .pick_file()
                else {
                    return Ok(None::<InitResponse>);
                };
                session.with_paths(|| {
                    let settings = settings::import_settings_from(&path)?;
                    let resolved = paths::resolve_database_path(&settings)?;
                    paths::ensure_parent_dir(&resolved)?;
                    let catalog_count = CatalogDb::open()?.catalog_count().unwrap_or(0);
                    Ok(Some(InitResponse {
                        settings,
                        catalog_count,
                        data_dir: path_to_string(&paths::data_dir()?),
                        resolved_database_path: path_to_string(&resolved),
                        settings_path: path_to_string(&paths::settings_path()?),
                    }))
                })
            }),
            (Method::Get, _) if path.starts_with("/api/") => {
                error_response(StatusCode(404), &AppError::Message("Not found".into()))
            }
            (Method::Post, _) if path.starts_with("/api/") => {
                error_response(StatusCode(404), &AppError::Message("Not found".into()))
            }
            (Method::Get, _) => serve_static(&path),
            _ => error_response(StatusCode(405), &AppError::Message("Method not allowed".into())),
        };

        let _ = request.respond(response);
    }

    Ok(())
}

fn with_session_route<T: Serialize, F: FnOnce(&crate::session::SessionHandle) -> AppResult<T>>(
    sessions: &SessionManager,
    session_id: Option<String>,
    f: F,
) -> Response<std::io::Cursor<Vec<u8>>> {
    let Some(id) = session_id.filter(|s| !s.is_empty()) else {
        return error_response(StatusCode(401), &AppError::Message("Missing X-Session-Id".into()));
    };
    let Some(session) = sessions.get(&id) else {
        return error_response(StatusCode(404), &AppError::Message("Session not found".into()));
    };
    match f(&session) {
        Ok(value) => json_response(StatusCode(200), &value),
        Err(err) => error_response(StatusCode(500), &err),
    }
}

fn parse_json_body<T: for<'de> Deserialize<'de>>(body: &[u8]) -> AppResult<T> {
    Ok(serde_json::from_slice(body)?)
}

fn header_value(headers: &[Header], name: &str) -> Option<String> {
    headers
        .iter()
        .find(|h| h.field.as_str().as_str() == name)
        .map(|h| h.value.as_str().to_string())
}

fn serve_static(path: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    let mut asset_path = path.trim_start_matches('/');
    if asset_path.is_empty() {
        asset_path = "index.html";
    }

    if let Some(file) = DistAssets::get(asset_path) {
        return bytes_response(StatusCode(200), file.data.as_ref(), mime_for(asset_path));
    }

    // SPA fallback
    if let Some(index) = DistAssets::get("index.html") {
        return bytes_response(StatusCode(200), index.data.as_ref(), "text/html; charset=utf-8");
    }

    error_response(
        StatusCode(404),
        &AppError::Message("Frontend assets not embedded — run npm run build".into()),
    )
}

fn mime_for(path: &str) -> &'static str {
    if path.ends_with(".js") {
        "text/javascript; charset=utf-8"
    } else if path.ends_with(".css") {
        "text/css; charset=utf-8"
    } else if path.ends_with(".svg") {
        "image/svg+xml"
    } else if path.ends_with(".html") {
        "text/html; charset=utf-8"
    } else {
        "application/octet-stream"
    }
}

fn json_response<T: Serialize>(status: StatusCode, value: &T) -> Response<std::io::Cursor<Vec<u8>>> {
    let body = serde_json::to_vec(value).unwrap_or_default();
    Response::from_data(body)
        .with_status_code(status)
        .with_header(Header::from_bytes("Content-Type", "application/json").unwrap())
        .with_header(cors_header())
}

fn bytes_response(status: StatusCode, bytes: &[u8], mime: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    Response::from_data(bytes.to_vec())
        .with_status_code(status)
        .with_header(Header::from_bytes("Content-Type", mime).unwrap())
        .with_header(cors_header())
}

fn error_response(status: StatusCode, err: &AppError) -> Response<std::io::Cursor<Vec<u8>>> {
    json_response(status, &json!({ "error": err.to_string() }))
}

fn cors_header() -> Header {
    Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap()
}
