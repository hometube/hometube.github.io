// HomeTube desktop shell (M0 spike).
//
// Owns the backend process: spawns the FastAPI server on launch, captures
// its logs, exposes status/logs/start/stop to the UI, and guarantees the
// child dies with the app. The sidecar is resolved from (in order):
//   HOMETUBE_SERVER  - packaged server binary (PyInstaller, later)
//   HOMETUBE_BACKEND - explicit backend directory containing main.py
//   <repo>/backend   - dev checkout, preferring the venv python
use serde::Serialize;
use std::env;
use std::io::{BufRead, BufReader, Read};
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{Manager, State};

const MAX_LOG_LINES: usize = 1000;

#[derive(Clone, Default)]
struct ServerState {
    child: Arc<Mutex<Option<Child>>>,
    logs: Arc<Mutex<Vec<String>>>,
}

#[derive(Serialize)]
struct ServerStatus {
    running: bool,
    healthy: bool,
    port: u16,
    backend_found: bool,
}

fn server_port() -> u16 {
    env::var("HOMETUBE_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8000)
}

fn log(logs: &Arc<Mutex<Vec<String>>>, line: impl Into<String>) {
    let mut logs = logs.lock().unwrap();
    if logs.len() >= MAX_LOG_LINES {
        logs.remove(0);
    }
    logs.push(line.into());
}

/// Copy every log line to the shell's own stdout too (useful in dev).
fn pump(logs: Arc<Mutex<Vec<String>>>, reader: impl Read + Send + 'static) {
    thread::spawn(move || {
        for line in BufReader::new(reader).lines().map_while(Result::ok) {
            println!("[backend] {line}");
            log(&logs, line);
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

/// Resolve the sidecar command: (executable, args).
fn sidecar_command(backend: &PathBuf) -> (PathBuf, Vec<String>) {
    if let Ok(bin) = env::var("HOMETUBE_SERVER") {
        return (PathBuf::from(bin), vec![]);
    }
    let venv_python = if cfg!(windows) {
        backend.join(".venv").join("Scripts").join("python.exe")
    } else {
        backend.join(".venv").join("bin").join("python")
    };
    if venv_python.exists() {
        return (venv_python, vec!["main.py".into()]);
    }
    let fallback = if cfg!(windows) { "python" } else { "python3" };
    (PathBuf::from(fallback), vec!["main.py".into()])
}

fn spawn_server(state: &ServerState) -> Result<(), String> {
    {
        let guard = state.child.lock().unwrap();
        if guard.is_some() {
            return Ok(()); // already running
        }
    }
    let backend = backend_dir().ok_or(
        "HomeTube backend not found (set HOMETUBE_BACKEND to the directory containing main.py)",
    )?;
    let (exe, args) = sidecar_command(&backend);

    let mut child = Command::new(&exe)
        .current_dir(&backend)
        .args(&args)
        .env("PORT", server_port().to_string())
        // The backend exits itself if this shell dies (covers hard kills;
        // ExitRequested below covers clean shutdowns).
        .env("HOMETUBE_WATCH_PARENT", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn {}: {e}", exe.display()))?;

    log(
        &state.logs,
        format!("[desktop] spawned backend: {} {:?}", exe.display(), args),
    );
    if let Some(stdout) = child.stdout.take() {
        pump(state.logs.clone(), stdout);
    }
    if let Some(stderr) = child.stderr.take() {
        pump(state.logs.clone(), stderr);
    }
    *state.child.lock().unwrap() = Some(child);
    Ok(())
}

fn healthy(port: u16) -> bool {
    TcpStream::connect(("127.0.0.1", port)).is_ok()
}

#[allow(dead_code)]
fn wait_healthy(port: u16, timeout: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if healthy(port) {
            return true;
        }
        thread::sleep(Duration::from_millis(250));
    }
    false
}

fn kill_server(state: &ServerState) {
    let mut guard = state.child.lock().unwrap();
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
        log(&state.logs, "[desktop] backend stopped");
    }
}

fn status_of(state: &ServerState) -> ServerStatus {
    // Reap the child if it exited on its own so `running` stays truthful.
    let mut guard = state.child.lock().unwrap();
    if let Some(child) = guard.as_mut() {
        if let Ok(Some(_)) = child.try_wait() {
            *guard = None;
        }
    }
    let running = guard.is_some();
    drop(guard);
    let port = server_port();
    ServerStatus {
        running,
        healthy: healthy(port),
        port,
        backend_found: backend_dir().is_some(),
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
fn server_start(state: State<ServerState>) -> Result<ServerStatus, String> {
    spawn_server(&state)?;
    Ok(status_of(&state))
}

#[tauri::command]
fn server_stop(state: State<ServerState>) -> Result<(), String> {
    kill_server(&state);
    Ok(())
}

fn main() {
    let state = ServerState::default();
    let setup_state = state.clone();

    tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            server_status,
            server_logs,
            server_start,
            server_stop
        ])
        .setup(move |_app| {
            // Auto-start the backend; the UI polls server_status until healthy.
            if let Err(e) = spawn_server(&setup_state) {
                eprintln!("[desktop] {e}");
                log(&setup_state.logs, format!("[desktop] {e}"));
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building HomeTube desktop")
        .run(|app_handle, event| {
            // Clean shutdown: kill the sidecar here. Hard kills (SIGKILL) are
            // covered by HOMETUBE_WATCH_PARENT on Unix; Windows needs Job
            // Objects (M1).
            if let tauri::RunEvent::ExitRequested { .. } = event {
                kill_server(&app_handle.state::<ServerState>());
            }
        });
}
