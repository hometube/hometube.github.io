// HomeTube desktop shell.
//
// Owns the backend process: spawns the FastAPI server on launch, captures
// its logs, exposes status/logs/start/stop to the UI, and guarantees the
// child dies with the app. The sidecar is resolved from (in order):
//   HOMETUBE_SERVER  - packaged server binary (PyInstaller, later)
//   HOMETUBE_BACKEND - explicit backend directory containing main.py
//   <repo>/backend   - dev checkout, preferring the venv python
//
// Port handling: if a HomeTube server already answers on the preferred port
// it is adopted (shown as "external", not killed); if some other process
// holds it, the next free port is used.
use serde::Serialize;
use serde_json::json;
use std::env;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{Manager, State};

const MAX_LOG_LINES: usize = 1000;
const DEFAULT_PORT: u16 = 8000;
const PORT_SCAN_RANGE: u16 = 100;
const MAX_LOG_FILE_BYTES: u64 = 5 * 1024 * 1024;

#[derive(Clone)]
struct ServerState {
    child: Arc<Mutex<Option<Child>>>,
    logs: Arc<Mutex<Vec<String>>>,
    file: Arc<Mutex<Option<File>>>,
    log_path: Arc<Mutex<Option<PathBuf>>>,
    port: Arc<AtomicU16>,
    adopted: Arc<AtomicBool>,
}

impl Default for ServerState {
    fn default() -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
            logs: Arc::new(Mutex::new(Vec::new())),
            file: Arc::new(Mutex::new(None)),
            log_path: Arc::new(Mutex::new(None)),
            port: Arc::new(AtomicU16::new(DEFAULT_PORT)),
            adopted: Arc::new(AtomicBool::new(false)),
        }
    }
}

#[derive(Serialize)]
struct ServerStatus {
    running: bool,
    healthy: bool,
    adopted: bool,
    port: u16,
    backend_found: bool,
}

fn preferred_port() -> u16 {
    env::var("HOMETUBE_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(DEFAULT_PORT)
}

// Storage: the shared config at ~/.config/hometube/config.json is the
// single source of truth for data_dir (same as paths.py / ht init), so the
// desktop app, the CLI, and a systemd server all agree.

fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn config_file() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".config").join("hometube").join("config.json"))
}

fn read_config() -> serde_json::Map<String, serde_json::Value> {
    config_file()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default()
}

#[derive(Serialize)]
struct StorageInfo {
    configured: bool,
    config_path: String,
    data_dir: Option<String>,
    suggested_dir: String,
    db_exists: bool,
}

fn storage_info_of() -> StorageInfo {
    let config_path = config_file()
        .map(|p| p.display().to_string())
        .unwrap_or_default();
    let data_dir = read_config()
        .get("data_dir")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from);
    let db_exists = data_dir
        .as_ref()
        .map(|d| PathBuf::from(d).join("db.sqlite").exists())
        .unwrap_or(false);
    let suggested_dir = home_dir()
        .map(|h| h.join("HomeTube").display().to_string())
        .unwrap_or_else(|| "HomeTube".into());
    StorageInfo {
        configured: data_dir.is_some(),
        config_path,
        suggested_dir,
        db_exists,
        data_dir,
    }
}

fn write_data_dir(dir: &str) -> Result<(), String> {
    let root = PathBuf::from(dir);
    fs::create_dir_all(root.join("downloads").join("videos"))
        .map_err(|e| format!("cannot create {dir}: {e}"))?;
    fs::create_dir_all(root.join("downloads").join("music"))
        .map_err(|e| format!("cannot create {dir}: {e}"))?;
    let cfg_file = config_file().ok_or("no home directory")?;
    cfg_file
        .parent()
        .map(|p| fs::create_dir_all(p))
        .transpose()
        .map_err(|e| e.to_string())?;
    let mut cfg = read_config();
    cfg.insert("data_dir".into(), json!(dir));
    let text = serde_json::to_string_pretty(&serde_json::Value::Object(cfg)).unwrap();
    let tmp = cfg_file.with_extension("json.tmp");
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &cfg_file).map_err(|e| e.to_string())?;
    Ok(())
}

fn log(state: &ServerState, line: impl Into<String>) {
    let line = line.into();
    println!("{line}"); // dev observability (pump() prefixes backend lines)
    if let Some(file) = state.file.lock().unwrap().as_mut() {
        let _ = writeln!(file, "{line}");
        let _ = file.flush();
    }
    let mut logs = state.logs.lock().unwrap();
    if logs.len() >= MAX_LOG_LINES {
        logs.remove(0);
    }
    logs.push(line);
}

/// Open (append) the rolling log file under the platform's app-log dir,
/// restarting it once it grows past MAX_LOG_FILE_BYTES.
fn open_log(state: &ServerState, dir: &PathBuf) {
    let _ = std::fs::create_dir_all(dir);
    let path = dir.join("hometube-desktop.log");
    if let Ok(meta) = path.metadata() {
        if meta.len() > MAX_LOG_FILE_BYTES {
            let _ = std::fs::remove_file(&path);
        }
    }
    if let Ok(file) = OpenOptions::new().create(true).append(true).open(&path) {
        *state.file.lock().unwrap() = Some(file);
        *state.log_path.lock().unwrap() = Some(path);
    }
}

/// Mirror the backend's output into the in-memory log (log() echoes).
fn pump(state: ServerState, reader: impl Read + Send + 'static) {
    thread::spawn(move || {
        for line in BufReader::new(reader).lines().map_while(Result::ok) {
            log(&state, format!("[backend] {line}"));
        }
    });
}

fn backend_dir() -> Option<PathBuf> {
    if let Ok(dir) = env::var("HOMETUBE_BACKEND") {
        let p = PathBuf::from(dir);
        if p.join("main.py").exists() {
            return Some(p);
        }
    }
    // Dev checkout: <repo>/desktop/src-tauri -> ../../backend
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../backend");
    if dev.join("main.py").exists() {
        return Some(dev.canonicalize().unwrap_or(dev));
    }
    None
}

/// Resolve the sidecar launch spec: (executable, args, working-dir). A
/// packaged HOMETUBE_SERVER binary wins over any source checkout; there is
/// no working-dir to set for it (the bundle is self-contained), whereas a
/// source checkout must run with cwd=backend so `import main`/siblings work.
fn resolve_sidecar() -> Result<(PathBuf, Vec<String>, Option<PathBuf>), String> {
    if let Ok(bin) = env::var("HOMETUBE_SERVER") {
        let p = PathBuf::from(&bin);
        if !p.exists() {
            return Err(format!("HOMETUBE_SERVER not found: {bin}"));
        }
        let cwd = p.parent().map(|d| d.to_path_buf());
        return Ok((p, vec![], cwd));
    }
    let backend = backend_dir().ok_or(
        "HomeTube backend not found (set HOMETUBE_SERVER to a packaged binary, or HOMETUBE_BACKEND to the directory containing main.py)",
    )?;
    let (exe, args) = python_for(&backend);
    Ok((exe, args, Some(backend)))
}

/// (executable, args) for running main.py from a source checkout, preferring
/// its venv python.
fn python_for(backend: &PathBuf) -> (PathBuf, Vec<String>) {
    let venv_python = if cfg!(windows) {
        backend.join(".venv").join("Scripts").join("python.exe")
    } else {
        backend.join(".venv").join("bin").join("python")
    };
    let exe = if venv_python.exists() {
        venv_python
    } else {
        PathBuf::from(if cfg!(windows) { "python" } else { "python3" })
    };
    (exe, vec!["main.py".into()])
}

/// Whether any sidecar (a packaged binary or a source backend) can launch.
fn sidecar_available() -> bool {
    match env::var("HOMETUBE_SERVER") {
        Ok(bin) => PathBuf::from(bin).exists(),
        Err(_) => backend_dir().is_some(),
    }
}

/// True when a HomeTube /api/status answers on this port (raw HTTP GET;
/// avoids pulling an HTTP client into the shell for one probe).
fn probe_backend(port: u16) -> bool {
    let Ok(mut stream) = TcpStream::connect(("127.0.0.1", port)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(750)));
    let _ = stream.write_all(
        b"GET /api/status HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
    );
    let mut buf = String::new();
    stream.read_to_string(&mut buf).is_ok() && buf.contains("\"status\":\"ok\"")
}

/// True when something accepts TCP on this port. A bind-based test is
/// unreliable here: both uvicorn and many dev servers set SO_REUSEADDR,
/// which lets a localhost bind "succeed" against an existing wildcard
/// listener while real clients would still collide.
fn port_in_use(port: u16) -> bool {
    TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_millis(200),
    )
    .is_ok()
}

/// Decide the port before spawning: adopt a running HomeTube, or fall back
/// to the next free port. Returns (port, adopted).
fn resolve_port(preferred: u16) -> Result<(u16, bool), String> {
    let end = preferred.saturating_add(PORT_SCAN_RANGE);
    for port in preferred..end {
        if probe_backend(port) {
            return Ok((port, true));
        }
        if !port_in_use(port) {
            return Ok((port, false));
        }
    }
    Err(format!("no free port in {preferred}..{end}"))
}

fn spawn_server(state: &ServerState) -> Result<(), String> {
    {
        let guard = state.child.lock().unwrap();
        if guard.is_some() {
            return Ok(()); // already running
        }
    }
    let (exe, args, cwd) = resolve_sidecar()?;
    let port = state.port.load(Ordering::SeqCst);
    // paths.py reads the same config.json, but pass DATA_DIR explicitly:
    // it beats a relative "data" resolved against the sidecar's cwd.
    let data_dir = read_config()
        .get("data_dir")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from);

    let mut cmd = Command::new(&exe);
    if let Some(dir) = &cwd {
        cmd.current_dir(dir);
    }
    cmd.args(&args)
        .env("PORT", port.to_string())
        // The backend exits itself if this shell dies (covers hard kills;
        // ExitRequested below covers clean shutdowns).
        .env("HOMETUBE_WATCH_PARENT", "1");
    if let Some(dir) = &data_dir {
        cmd.env("DATA_DIR", dir);
    }
    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn {}: {e}", exe.display()))?;

    log(
        state,
        format!(
            "[desktop] spawned backend on :{port} (data: {}): {} {:?}",
            data_dir.as_deref().unwrap_or("default"),
            exe.display(),
            args
        ),
    );
    if let Some(stdout) = child.stdout.take() {
        pump(state.clone(), stdout);
    }
    if let Some(stderr) = child.stderr.take() {
        pump(state.clone(), stderr);
    }
    *state.child.lock().unwrap() = Some(child);
    Ok(())
}

fn healthy(state: &ServerState) -> bool {
    TcpStream::connect(("127.0.0.1", state.port.load(Ordering::SeqCst))).is_ok()
}

fn kill_server(state: &ServerState) {
    let mut guard = state.child.lock().unwrap();
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
        log(state, "[desktop] backend stopped");
    }
    state.adopted.store(false, Ordering::SeqCst);
}

fn status_of(state: &ServerState) -> ServerStatus {
    // Reap the child if it exited on its own so `running` stays truthful.
    let mut guard = state.child.lock().unwrap();
    if let Some(child) = guard.as_mut() {
        if let Ok(Some(_)) = child.try_wait() {
            *guard = None;
        }
    }
    let adopted = state.adopted.load(Ordering::SeqCst)
        // Dropped adoption if the adopted server itself went away.
        && healthy(state);
    let running = guard.is_some() || adopted;
    drop(guard);
    ServerStatus {
        running,
        healthy: healthy(state),
        adopted,
        port: state.port.load(Ordering::SeqCst),
        backend_found: sidecar_available(),
    }
}

#[tauri::command]
fn server_status(state: State<ServerState>) -> ServerStatus {
    status_of(&state)
}

#[tauri::command]
fn server_logs(state: State<ServerState>, tail: Option<usize>) -> Vec<String> {
    let logs = state.logs.lock().unwrap();
    let n = tail.unwrap_or(200).min(logs.len());
    logs[logs.len() - n..].to_vec()
}

#[tauri::command]
fn server_log_path(state: State<ServerState>) -> Option<String> {
    state
        .log_path
        .lock()
        .unwrap()
        .as_ref()
        .map(|p| p.display().to_string())
}

#[tauri::command]
fn server_start(state: State<ServerState>) -> Result<ServerStatus, String> {
    if status_of(&state).running {
        return Ok(status_of(&state));
    }
    let (port, adopted) = resolve_port(preferred_port())?;
    state.port.store(port, Ordering::SeqCst);
    state.adopted.store(adopted, Ordering::SeqCst);
    if adopted {
        log(
            &state,
            format!("[desktop] adopting HomeTube already running on :{port} (external)"),
        );
    } else {
        spawn_server(&state)?;
    }
    Ok(status_of(&state))
}

#[tauri::command]
fn server_stop(state: State<ServerState>) -> Result<(), String> {
    let child_running = state.child.lock().unwrap().is_some();
    if !child_running && state.adopted.load(Ordering::SeqCst) {
        return Err(
            "that server was started outside HomeTube Desktop; stop it where it runs".into(),
        );
    }
    kill_server(&state);
    Ok(())
}

#[tauri::command]
fn storage_info() -> StorageInfo {
    storage_info_of()
}

/// Point the library at a new folder and restart the server so it picks it
/// up. The adopted (external) server is not ours to restart.
#[tauri::command]
fn set_data_dir(state: State<ServerState>, dir: String) -> Result<StorageInfo, String> {
    write_data_dir(&dir)?;
    log(&state, format!("[desktop] data dir set to {dir}"));
    let child_running = state.child.lock().unwrap().is_some();
    if child_running {
        kill_server(&state);
        // Reuse the current port: it was chosen for this child and just
        // died with it, so resolve_port could only wander (or wrongly
        // adopt some other instance).
        spawn_server(&state)?;
    } else if state.adopted.load(Ordering::SeqCst) {
        log(
            &state,
            "[desktop] external server keeps its previous data dir until restarted",
        );
    }
    Ok(storage_info_of())
}

fn main() {
    let state = ServerState::default();
    let setup_state = state.clone();

    tauri::Builder::default()
        // Folder picker for the storage onboarding (dialog:default capability).
        .plugin(tauri_plugin_dialog::init())
        // One shell = one server. A second launch focuses this window; a
        // duplicate uvicorn would only fight over the port and SQLite.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            server_status,
            server_logs,
            server_log_path,
            server_start,
            server_stop,
            storage_info,
            set_data_dir
        ])
        .on_window_event(|window, event| {
            // Closing the window keeps the server running; the tray (or
            // dock Reopen) brings it back, Quit stops everything.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(move |app| {
            // Persist logs under the platform app-log dir (~/Library/Logs on
            // macOS, %APPDATA%/…/logs on Windows, ~/.local/share/… on Linux).
            if let Ok(dir) = app.path().app_log_dir() {
                open_log(&setup_state, &dir);
            }
            // Tray: Open restores the window, Quit ends the app (which
            // kills the server via ExitRequested).
            let open_item = tauri::menu::MenuItem::with_id(app, "open", "Open HomeTube", true, None::<&str>)?;
            let quit_item = tauri::menu::MenuItem::with_id(app, "quit", "Quit HomeTube", true, None::<&str>)?;
            let tray_menu = tauri::menu::Menu::with_items(app, &[&open_item, &quit_item])?;
            tauri::tray::TrayIconBuilder::with_id("main-tray")
                .tooltip("HomeTube")
                .icon(
                    app.default_window_icon()
                        .cloned()
                        .ok_or("no bundled window icon")?,
                )
                .menu(&tray_menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            // Auto-start (or adopt) the backend; the UI polls server_status.
            let (port, adopted) = resolve_port(preferred_port()).unwrap_or_else(|e| {
                eprintln!("[desktop] {e}");
                (preferred_port(), false)
            });
            setup_state.port.store(port, Ordering::SeqCst);
            setup_state.adopted.store(adopted, Ordering::SeqCst);
            if adopted {
                log(
                    &setup_state,
                    format!("[desktop] adopting HomeTube already running on :{port} (external)"),
                );
            } else if let Err(e) = spawn_server(&setup_state) {
                eprintln!("[desktop] {e}");
                log(&setup_state, format!("[desktop] {e}"));
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building HomeTube desktop")
        .run(|app_handle, event| {
            match event {
                // Clean shutdown: kill the sidecar here. Hard kills (SIGKILL)
                // are covered by HOMETUBE_WATCH_PARENT on Unix; Windows needs
                // Job Objects (M1).
                tauri::RunEvent::ExitRequested { .. } => {
                    kill_server(&app_handle.state::<ServerState>());
                }
                // macOS: reopening from the Dock after the window closed.
                tauri::RunEvent::Reopen { .. } => {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                _ => {}
            }
        });
}
