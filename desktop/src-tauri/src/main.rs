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
use std::env;
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

#[derive(Clone)]
struct ServerState {
    child: Arc<Mutex<Option<Child>>>,
    logs: Arc<Mutex<Vec<String>>>,
    port: Arc<AtomicU16>,
    adopted: Arc<AtomicBool>,
}

impl Default for ServerState {
    fn default() -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
            logs: Arc::new(Mutex::new(Vec::new())),
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

fn log(state: &ServerState, line: impl Into<String>) {
    let line = line.into();
    println!("{line}"); // dev observability (pump() prefixes backend lines)
    let mut logs = state.logs.lock().unwrap();
    if logs.len() >= MAX_LOG_LINES {
        logs.remove(0);
    }
    logs.push(line);
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
    let backend = backend_dir().ok_or(
        "HomeTube backend not found (set HOMETUBE_BACKEND to the directory containing main.py)",
    )?;
    let (exe, args) = sidecar_command(&backend);
    let port = state.port.load(Ordering::SeqCst);

    let mut child = Command::new(&exe)
        .current_dir(&backend)
        .args(&args)
        .env("PORT", port.to_string())
        // The backend exits itself if this shell dies (covers hard kills;
        // ExitRequested below covers clean shutdowns).
        .env("HOMETUBE_WATCH_PARENT", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn {}: {e}", exe.display()))?;

    log(
        state,
        format!("[desktop] spawned backend on :{port}: {} {:?}", exe.display(), args),
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
        .setup(move |app| {
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
            let _ = app;
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
