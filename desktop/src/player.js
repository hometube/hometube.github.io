// Playback engine: one HTMLAudioElement + reactive state, mounted once at
// module scope so it survives every view change. Serves from
// GET /api/music/{id}/file, which range-streams and lazy-downloads.
import { reactive } from "vue";
import { apiBase } from "./store";

const audio = new Audio();
audio.preload = "metadata";

export const player = reactive({
  queue: [], // music rows
  order: [], // queue indices in play order
  orderPos: -1,
  playing: false,
  currentTime: 0,
  duration: 0,
  volume: Number(localStorage.getItem("hometube.volume") ?? 1),
  shuffle: localStorage.getItem("hometube.shuffle") === "1",
  repeat: localStorage.getItem("hometube.repeat") || "off", // off | all | one
  loading: false, // file still resolving (server may be lazy-downloading)
});

export function musicUrl(id) {
  return `${apiBase()}/api/music/${id}/file`;
}

export function currentTrack() {
  const qi = player.order[player.orderPos];
  return qi == null ? null : player.queue[qi] || null;
}

function shuffled(n) {
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
}

function buildOrder(current = -1) {
  let idx = player.shuffle ? shuffled(player.queue.length) : player.queue.map((_, i) => i);
  if (current >= 0) {
    idx = idx.filter((i) => i !== current);
    idx.splice(player.shuffle ? Math.floor(Math.random() * (idx.length + 1)) : 0, 0, current);
  }
  player.order = idx;
  player.orderPos = current >= 0 ? idx.indexOf(current) : -1;
}

export function playList(items, startIndex = 0) {
  player.queue = items.slice();
  buildOrder(startIndex);
  loadCurrent(true);
}

export function jumpInOrder(pos) {
  if (pos < 0 || pos >= player.order.length) return;
  player.orderPos = pos;
  loadCurrent(true);
}

export function next(auto = false) {
  if (!player.order.length) return;
  if (auto && player.repeat === "one") {
    audio.currentTime = 0;
    audio.play().catch(() => {});
    return;
  }
  if (player.orderPos + 1 < player.order.length) {
    player.orderPos++;
    loadCurrent(true);
  } else if (player.repeat === "all") {
    buildOrder(player.shuffle ? -1 : 0);
    loadCurrent(true);
  } else {
    audio.pause();
    player.playing = false;
    if (auto) player.orderPos = player.order.length - 1;
  }
}

export function prev() {
  if (!player.order.length) return;
  if (player.currentTime > 3) {
    seek(0);
    return;
  }
  if (player.orderPos > 0) {
    player.orderPos--;
    loadCurrent(true);
  } else {
    seek(0);
  }
}

function loadCurrent(play) {
  const t = currentTrack();
  if (!t) return;
  player.loading = true;
  audio.src = musicUrl(t.id);
  if (play) audio.play().catch(() => {});
  updateMediaSession();
}

export function toggle() {
  const t = currentTrack();
  if (!t) {
    // No queue yet: nothing to toggle (callers should not show the bar).
    return;
  }
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
}

export function pauseMusic() {
  if (!audio.paused) audio.pause();
}

export function seek(t) {
  if (!Number.isFinite(t)) return;
  audio.currentTime = t;
  player.currentTime = t;
}

export function setVolume(v) {
  player.volume = Math.min(1, Math.max(0, v));
  audio.volume = player.volume;
  localStorage.setItem("hometube.volume", String(player.volume));
}

export function toggleShuffle() {
  player.shuffle = !player.shuffle;
  localStorage.setItem("hometube.shuffle", player.shuffle ? "1" : "0");
  const current = player.order[player.orderPos];
  buildOrder(current == null ? -1 : current);
}

export function cycleRepeat() {
  player.repeat = { off: "all", all: "one", one: "off" }[player.repeat];
  localStorage.setItem("hometube.repeat", player.repeat);
}

// --- element events ---
audio.volume = player.volume;
audio.addEventListener("play", () => {
  player.playing = true;
  player.loading = false;
  updateMediaSession();
});
audio.addEventListener("pause", () => {
  player.playing = false;
  updateMediaSession();
});
audio.addEventListener("waiting", () => (player.loading = true));
audio.addEventListener("playing", () => (player.loading = false));
audio.addEventListener("timeupdate", () => (player.currentTime = audio.currentTime));
audio.addEventListener("loadedmetadata", () => (player.duration = audio.duration || 0));
audio.addEventListener("ended", () => next(true));
audio.addEventListener("error", () => (player.loading = false));

// --- Media Session (media keys / lock screen where WKWebView exposes it) ---
function updateMediaSession() {
  if (!("mediaSession" in navigator)) return;
  const t = currentTrack();
  if (t) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title || "Untitled",
        artist: t.artist || "HomeTube",
        artwork: t.album_art ? [{ src: t.album_art, sizes: "512x512" }] : [],
      });
    } catch {
      /* MediaMetadata unavailable */
    }
  }
  navigator.mediaSession.playbackState = player.playing ? "playing" : "paused";
}

if ("mediaSession" in navigator) {
  const on = (action, fn) => {
    try {
      navigator.mediaSession.setActionHandler(action, fn);
    } catch {
      /* unsupported action */
    }
  };
  on("play", () => audio.play().catch(() => {}));
  on("pause", () => audio.pause());
  on("previoustrack", prev);
  on("nexttrack", () => next());
  on("seekto", (d) => d.seekTime != null && seek(d.seekTime));
}

export function fmtTime(s) {
  if (!Number.isFinite(s)) return "0:00";
  s = Math.max(0, Math.floor(s));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

// Hours-aware duration for videos/podcasts.
export function fmtLong(s) {
  if (!Number.isFinite(s) || s <= 0) return "";
  s = Math.floor(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
    : `${m}:${String(s % 60).padStart(2, "0")}`;
}
