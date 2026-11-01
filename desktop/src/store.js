// Shared app state + tiny API client. The desktop app is server-mode-only:
// the sidecar is always local, so loopback auth applies and no JWT is needed.
import { reactive } from "vue";
import { invoke } from "@tauri-apps/api/core";

export const state = reactive({
  status: null, // ServerStatus from the Rust shell
  storage: null, // StorageInfo from the Rust shell
  users: [],
  playlists: [], // current user's playlists, for the sidebar sub-nav
  currentUserId: null,
  openPlaylistId: null,
  queueOpen: false,
  queueWidth: Math.min(720, Math.max(300, Number(localStorage.getItem("hometube.queueWidth.v4")) || 400)),
  view: localStorage.getItem("hometube.view") || "home",
});

export function wizardDone() {
  return localStorage.getItem("hometube.wizardDone") === "1";
}
export function finishWizard() {
  localStorage.setItem("hometube.wizardDone", "1");
}

export function apiBase() {
  return state.status ? `http://127.0.0.1:${state.status.port}` : null;
}
export function healthy() {
  return !!state.status?.healthy;
}

export async function api(path, opts = {}) {
  const res = await fetch(`${apiBase()}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
  return res.json();
}

export function currentUser() {
  return (
    state.users.find((u) => u.id === state.currentUserId) ||
    state.users[0] ||
    null
  );
}

export function setCurrentUser(id) {
  state.currentUserId = id;
  localStorage.setItem("hometube.currentUser", String(id));
}

export function navigate(view) {
  state.view = view;
  localStorage.setItem("hometube.view", view);
}

export function openPlaylist(id) {
  state.openPlaylistId = id;
  navigate("playlists");
}

export async function refreshStatus() {
  state.status = await invoke("server_status");
}

export async function refreshStorage() {
  state.storage = await invoke("storage_info");
}

export async function refreshUsers() {
  if (!healthy()) return;
  try {
    state.users = await api("/api/users");
  } catch {
    return; // server may be mid-restart (e.g. folder change)
  }
  const saved = Number(localStorage.getItem("hometube.currentUser"));
  if (state.users.some((u) => u.id === saved)) {
    state.currentUserId = saved;
  } else if (state.users.length) {
    setCurrentUser(state.users[0].id);
  } else {
    state.currentUserId = null;
  }
  refreshPlaylists();
}

export async function refreshPlaylists() {
  const u = currentUser();
  if (!healthy() || !u) {
    state.playlists = [];
    return;
  }
  try {
    state.playlists = await api(`/api/playlists?user_id=${u.id}`);
  } catch {
    /* server may be mid-restart */
  }
}

// Faces: initials on a gradient picked deterministically from the name,
// sampled from the brand ramp (coral → magenta → purple).
const RAMPS = [
  ["#f4614f", "#d0379f"],
  ["#d0379f", "#9b2fbf"],
  ["#f4614f", "#9b2fbf"],
  ["#e0559b", "#7a2fd0"],
  ["#f4614f", "#7a2fd0"],
  ["#d0379f", "#e0559b"],
];

export function faceGradient(name) {
  let h = 0;
  for (const ch of String(name || "?")) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return RAMPS[h % RAMPS.length];
}

export function initials(name) {
  const parts = String(name || "?").trim().split(/\s+/).filter(Boolean);
  const first = (parts[0] || "?")[0];
  const second = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + second).toUpperCase();
}
