//! Tauri shell. Kept thin on purpose: filesystem, file watching, Git status, keychain,
//! search index, plugin folder discovery and a permission-free HTTP bridge.
//! Every command delegates to `vastitecture-shell` or a platform crate.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use vastitecture_shell as shell;

#[derive(Default)]
struct AppState {
    watcher: Mutex<Option<RecommendedWatcher>>,
    search: Mutex<Option<(PathBuf, shell::SearchIndex)>>,
}

#[tauri::command]
fn ws_read_all(root: String) -> Result<BTreeMap<String, String>, String> {
    shell::read_all(Path::new(&root))
}

#[tauri::command]
fn ws_write(root: String, path: String, content: String) -> Result<(), String> {
    shell::write_file(Path::new(&root), &path, &content)
}

#[tauri::command]
fn ws_remove(root: String, path: String) -> Result<(), String> {
    shell::remove_file(Path::new(&root), &path)
}

/// Watch the workspace folder and emit a debounced "ws-changed" event (git pull, external editors).
#[tauri::command]
fn ws_watch(app: AppHandle, state: State<AppState>, root: String) -> Result<(), String> {
    let pending = Arc::new(AtomicBool::new(false));
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        let relevant = event.paths.iter().any(|p| {
            let s = p.to_string_lossy().replace('\\', "/");
            !s.contains("/.git/") && !s.contains("/.vastitecture/cache") && !s.ends_with(".tmp")
        });
        if !relevant || pending.swap(true, Ordering::SeqCst) {
            return;
        }
        let app = app.clone();
        let pending = pending.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(250));
            pending.store(false, Ordering::SeqCst);
            let _ = app.emit("ws-changed", ());
        });
    })
    .map_err(|e| e.to_string())?;
    watcher.watch(Path::new(&root), RecursiveMode::Recursive).map_err(|e| e.to_string())?;
    *state.watcher.lock().unwrap() = Some(watcher);
    Ok(())
}

#[tauri::command]
fn ws_unwatch(state: State<AppState>) {
    *state.watcher.lock().unwrap() = None;
}

#[tauri::command]
fn write_binary(path: String, bytes: Vec<u8>) -> Result<(), String> {
    std::fs::write(path, bytes).map_err(|e| e.to_string())
}

#[tauri::command]
fn git_status(root: String) -> shell::GitInfo {
    shell::git_status(Path::new(&root))
}

#[tauri::command]
fn git_diff(root: String, path: String) -> Result<String, String> {
    shell::git_diff(Path::new(&root), &path)
}

/// Full-text search over the workspace files. The index is a cache under .vastitecture/cache.
#[tauri::command]
fn search(state: State<AppState>, root: String, query: String) -> Result<Vec<shell::SearchHit>, String> {
    let root_path = PathBuf::from(&root);
    let mut guard = state.search.lock().unwrap();
    if guard.as_ref().map(|(r, _)| r != &root_path).unwrap_or(true) {
        let db = root_path.join(".vastitecture").join("cache").join("search.sqlite");
        *guard = Some((root_path.clone(), shell::SearchIndex::open(Some(&db))?));
    }
    let (_, index) = guard.as_mut().unwrap();
    index.sync(&shell::read_all(&root_path)?)?;
    index.search(&query, 50)
}

const KEYCHAIN_SERVICE: &str = "vastitecture";

#[tauri::command]
fn secret_get(name: String) -> Result<Option<String>, String> {
    match keyring::Entry::new(KEYCHAIN_SERVICE, &name).map_err(|e| e.to_string())?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn secret_set(name: String, value: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &name).map_err(|e| e.to_string())?;
    if value.is_empty() {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    } else {
        entry.set_password(&value).map_err(|e| e.to_string())
    }
}

#[derive(Serialize)]
struct HttpResponse {
    status: u16,
    headers: HashMap<String, String>,
    text: String,
}

/// HTTP bridge for connectors, plugins and the AI assistant. The webview checks plugin
/// permissions before calling; the app itself never calls this unless the user runs one of those.
#[tauri::command]
async fn http_fetch(url: String, method: Option<String>, headers: Option<HashMap<String, String>>, body: Option<String>) -> Result<HttpResponse, String> {
    let method = reqwest::Method::from_bytes(method.unwrap_or_else(|| "GET".into()).as_bytes()).map_err(|e| e.to_string())?;
    let mut req = reqwest::Client::new().request(method, &url);
    for (k, v) in headers.unwrap_or_default() {
        req = req.header(k, v);
    }
    if let Some(b) = body {
        req = req.body(b);
    }
    let res = req.send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let headers = res.headers().iter().map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string())).collect();
    Ok(HttpResponse { status, headers, text: res.text().await.map_err(|e| e.to_string())? })
}

/// Plugin folders from ~/.vastitecture/plugins and <workspace>/.vastitecture/plugins.
#[tauri::command]
fn plugins_list(app: AppHandle, workspace: Option<String>) -> Vec<shell::PluginFolder> {
    let mut out = vec![];
    if let Ok(home) = app.path().home_dir() {
        out.extend(shell::list_plugins(&home.join(".vastitecture").join("plugins"), "user"));
    }
    if let Some(ws) = workspace {
        out.extend(shell::list_plugins(&Path::new(&ws).join(".vastitecture").join("plugins"), "workspace"));
    }
    out
}

#[tauri::command]
fn plugin_read(dir: String, file: String) -> Result<String, String> {
    shell::read_plugin_file(Path::new(&dir), &file)
}

/// Read-only AWS discovery through the user's own AWS CLI and local profile.
#[tauri::command]
async fn aws_cli(service: String, operation: String, profile: Option<String>, region: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || shell::aws_cli(&service, &operation, profile.as_deref(), region.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .setup(|app| {
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            let _ = app;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ws_read_all,
            ws_write,
            ws_remove,
            ws_watch,
            ws_unwatch,
            write_binary,
            git_status,
            git_diff,
            search,
            secret_get,
            secret_set,
            http_fetch,
            plugins_list,
            plugin_read,
            aws_cli
        ])
        .run(tauri::generate_context!())
        .expect("error while running Vastitecture");
}
