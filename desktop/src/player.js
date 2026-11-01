// Playback engine: one HTMLAudioElement + reactive state, mounted once at
// module scope so it survives every view change. Serves from
// GET /api/music/{id}/file, which range-streams and lazy-downloads.
import { reactive } from "vue";
import { api, apiBase } from "./store";

const audio = new Audio();
audio.preload = "metadata";

// Session persistence: last queue + play order + position, so a webview
// reload (or app restart) brings the miniplayer back exactly where it was.
const SESSION_KEY = "hometube.se…sion";
let lastSaved = 0;
let pendingSeek = 0;

function persistSession() {
  lastSaved = audio.currentTime;
  try {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        q: player.queue.map((x) => x.id),
        o: player.order,
        p: player.orderPos,
        t: player.currentTime,
      })
    );
  } catch {
    /* storage full — persistence is best-effort */
  }
}

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
  error: "", // human reason the current track failed (empty = healthy)
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

// Remove one entry from the play order (the queue view's ×). Removing the
// current entry advances to whatever is next, like skipping.
export function removeFromOrder(pos) {
  if (pos < 0 || pos >= player.order.length) return;
  const isCurrent = pos === player.orderPos;
  player.order.splice(pos, 1);
  if (isCurrent) {
    if (!player.order.length) {
      player.orderPos = -1;
      audio.pause();
      audio.removeAttribute("src");
      player.playing = false;
      player.loading = false;
      player.queue = [];
      localStorage.removeItem(SESSION_KEY);
      return;
    }
    player.orderPos = Math.min(player.orderPos, player.order.length - 1);
    loadCurrent(true);
  } else if (pos < player.orderPos) {
    player.orderPos--;
  }
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
  player.error = "";
  audio.src = musicUrl(t.id);
  if (play) audio.play().catch(() => {});
  updateMediaSession();
  persistSession();
}

// Rebuild last session after boot/reload: surviving rows only, old order
// remapped onto them, resume point applied at loadedmetadata. Deliberately
// does not autoplay (WKWebView wants a user gesture); the bar + queue come
// back ready to press play.
export async function restorePlayback() {
  if (player.queue.length) return;
  let s;
  try {
    s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return;
  }
  if (!s || !Array.isArray(s.q) || !s.q.length) return;
  let rows;
  try {
    rows = await api("/api/music");
  } catch {
    return; // server not up yet; the healthy() watcher will retry
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  const keep = new Map(); // old queue index -> new queue index
  s.q.forEach((id, i) => {
    if (byId.has(id)) keep.set(i, keep.size);
  });
  const queue = s.q.map((id) => byId.get(id)).filter(Boolean);
  if (!queue.length) {
    localStorage.removeItem(SESSION_KEY);
    return;
  }
  const order = (Array.isArray(s.o) ? s.o : []).filter((i) => keep.has(i)).map((i) => keep.get(i));
  player.queue = queue;
  player.order = order.length ? order : queue.map((_, i) => i);
  player.orderPos = order.length ? Math.min(Math.max(0, s.p ?? 0), order.length - 1) : -1;
  if (player.orderPos >= 0) {
    pendingSeek = Number(s.t) || 0;
    loadCurrent(false);
    player.loading = false; // paused resume — no fetch spinner until play
  }
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
  persistSession(); // capture the exact paused position
  updateMediaSession();
});
audio.addEventListener("waiting", () => (player.loading = true));
audio.addEventListener("playing", () => (player.loading = false));
audio.addEventListener("timeupdate", () => {
  player.currentTime = audio.currentTime;
  if (player.playing && Math.abs(audio.currentTime - lastSaved) >= 5) persistSession();
});
audio.addEventListener("loadedmetadata", () => {
  player.duration = audio.duration || 0;
  if (pendingSeek > 1) {
    try {
      audio.currentTime = Math.min(pendingSeek, Math.max(0, (audio.duration || 0) - 1));
    } catch {
      /* seek before stream ready */
    }
    pendingSeek = 0;
  }
});
audio.addEventListener("ended", () => next(true));
audio.addEventListener("error", () => {
  player.loading = false;
  const t = currentTrack();
  if (t) void probePlaybackError(musicUrl(t.id));
});

// The media element swallows the server's reason, so re-probe the URL
// (server fails fast for known-bad tracks) and translate it into words.
async function probePlaybackError(url) {
  let msg = "Playback failed — could not fetch the file.";
  try {
    const res = await fetch(url, { headers: { Range: "bytes=0-0" } });
    if (res.ok) {
      // The file fetches fine but the media element still failed: usually an
      // undecodable container (WKWebView has no Opus/Ogg/WebM audio).
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (/opus|ogg|webm|x-matroska/.test(ct))
        player.error = `Can't play ${ct.replace("audio/", "").toUpperCase()} on desktop — convert with: ht fixaudio`;
      return; // otherwise transient; pressing play again usually recovers
    }
    let detail = "";
    try {
      detail = String((await res.json()).detail || "");
    } catch {
      /* non-JSON error body */
    }
    if (detail) msg = friendlyPlaybackError(detail);
  } catch {
    /* server unreachable */
  }
  player.error = msg;
}

function friendlyPlaybackError(detail) {
  const d = String(detail || "");
  if (/Premium/i.test(d))
    return "Needs YouTube Music Premium — give the server browser cookies (ht settings set cookies_browser safari)";
  if (/unavailable/i.test(d)) return "Video unavailable on YouTube";
  const m = /ERROR:.*:\s*(.+)$/.exec(d);
  return (m ? m[1] : d).replace(/^Download failed:\s*/, "").slice(0, 180);
}

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
