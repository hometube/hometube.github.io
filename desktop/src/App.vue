<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { listen } from "@tauri-apps/api/event";
import {
  currentUser,
  healthy,
  navigate,
  openPlaylist,
  refreshStatus,
  refreshStorage,
  refreshUsers,
  state,
  wizardDone,
} from "./store";
import { next, player, prev, restorePlayback, seek, toggle } from "./player";
import { checkForUpdate, updateAvailable } from "./updates";
import WizardView from "./views/WizardView.vue";
import HomeView from "./views/HomeView.vue";
import PlaylistsView from "./views/PlaylistsView.vue";
import VideosView from "./views/VideosView.vue";
import PodcastsView from "./views/PodcastsView.vue";
import DevicesView from "./views/DevicesView.vue";
import SettingsView from "./views/SettingsView.vue";
import TransportBar from "./components/TransportBar.vue";
import QueuePanel from "./components/QueuePanel.vue";

const NAV = [
  { id: "home", label: "Home" },
  { id: "playlists", label: "Music" },
  { id: "videos", label: "Videos" },
  { id: "podcasts", label: "Podcasts" },
  { id: "devices", label: "Devices" },
  { id: "settings", label: "Settings" },
];
const VIEWS = {
  home: HomeView,
  playlists: PlaylistsView,
  videos: VideosView,
  podcasts: PodcastsView,
  devices: DevicesView,
  settings: SettingsView,
};

const inWizard = ref(!wizardDone());
const view = computed(() => VIEWS[state.view] || HomeView);
const face = computed(() => currentUser());

// Once the server is healthy, load the household (and keep it fresh for
// faces added from the CLI or the mobile app), and rehydrate the last
// playback session exactly once.
let playbackRestored = false;
watch(
  () => healthy(),
  (ok) => {
    if (!ok) return;
    refreshUsers();
    if (!playbackRestored) {
      playbackRestored = true;
      restorePlayback();
    }
  }
);

let timers = [];
let unlisten = null;
let unlistenPlayer = null;

// Global keyboard transport. Ignored while typing (inputs, modals' text
// fields) and on focused buttons, where Space/Enter belong to the control.
function onKey(e) {
  if (inWizard.value) return;
  const t = e.target instanceof HTMLElement ? e.target : null;
  if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
  const mod = e.metaKey || e.ctrlKey;
  if (e.code === "Space") {
    if (t && (t.tagName === "BUTTON" || t.getAttribute("role") === "button")) return;
    e.preventDefault();
    toggle();
  } else if (mod && e.key === "ArrowRight") {
    e.preventDefault();
    next();
  } else if (mod && e.key === "ArrowLeft") {
    e.preventDefault();
    prev();
  } else if (!mod && e.key === "ArrowRight" && player.duration) {
    e.preventDefault();
    seek(Math.min(player.duration, player.currentTime + 5));
  } else if (!mod && e.key === "ArrowLeft" && player.duration) {
    e.preventDefault();
    seek(Math.max(0, player.currentTime - 5));
  } else if (!mod && e.key.toLowerCase() === "q") {
    state.queueOpen = !state.queueOpen;
  }
}

onMounted(async () => {
  window.addEventListener("keydown", onKey);
  refreshStatus();
  refreshStorage();
  checkForUpdate(); // GitHub Releases check; silent unless something is newer
  timers.push(setInterval(refreshStatus, 2000));
  timers.push(setInterval(refreshStorage, 10000));
  timers.push(setInterval(refreshUsers, 10000));
  // ⌘, from the native menu jumps to the Settings pane; the Playback
  // submenu drives the transport.
  unlisten = await listen("menu-settings", () => navigate("settings"));
  unlistenPlayer = await listen("menu-player", (e) => {
    if (e.payload === "playpause") toggle();
    else if (e.payload === "next") next();
    else if (e.payload === "prev") prev();
  });
});
onUnmounted(() => {
  window.removeEventListener("keydown", onKey);
  timers.forEach(clearInterval);
  if (unlisten) unlisten();
  if (unlistenPlayer) unlistenPlayer();
});
</script>

<template>
  <WizardView v-if="inWizard" @done="inWizard = false" />
  <div v-else class="shell">
    <aside>
      <div class="brand">
        <img src="/icon.png" alt="" />
        <span>HomeTube</span>
      </div>
      <nav>
        <template v-for="n in NAV" :key="n.id">
          <button
            class="nav-item"
            :class="{ active: state.view === n.id }"
            @click="state.openPlaylistId = null; navigate(n.id)"
          >
            {{ n.label }}
            <span v-if="n.id === 'settings' && updateAvailable()" class="nav-badge"
              >1</span
            >
          </button>
          <!-- The current face's playlists, indented under Playlists. -->
          <div v-if="n.id === 'playlists' && state.playlists.length" class="nav-pls">
            <button
              v-for="p in state.playlists"
              :key="p.id"
              class="nav-pl"
              :class="{ active: state.view === 'playlists' && state.openPlaylistId === p.id }"
              :title="p.name"
              @click="openPlaylist(p.id)"
            >
              {{ p.name }}
            </button>
          </div>
        </template>
      </nav>
      <div class="side-foot">
        <span
          class="status-dot"
          :class="state.status?.adopted ? 'ext' : healthy() ? 'ok' : 'bad'"
          :title="state.status?.adopted ? 'External server' : healthy() ? 'Server running' : 'Server stopped'"
        />
        <span v-if="face" class="side-face">{{ face.username }}</span>
      </div>
    </aside>
    <div class="body">
      <div class="content">
        <main :class="{ flush: state.view === 'playlists' && state.openPlaylistId }">
          <Transition name="view" mode="out-in">
            <component :is="view" :key="state.view" />
          </Transition>
        </main>
        <Transition name="bar">
          <TransportBar v-if="player.queue.length" />
        </Transition>
      </div>
      <Transition name="panel">
        <QueuePanel v-if="player.queue.length && state.queueOpen" />
      </Transition>
    </div>
  </div>
</template>

<style>
:root {
  color-scheme: dark;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  --bg: #121016;
  --panel: #1c1922;
  --inset: #16131b;
  --border: #2e2937;
  --text: #ece9f2;
  --muted: #9d95aa;
  --accent: #e0559b;
  --grad: linear-gradient(135deg, #f4614f, #d0379f, #9b2fbf);
}
* { box-sizing: border-box; }
/* App shell: scrolling belongs to main/nav, never the page itself. */
html, body { margin: 0; overflow: hidden; background: var(--bg); color: var(--text); }
a { color: var(--accent); }
button {
  background-image: var(--grad); color: #fff; border: 0; border-radius: 8px;
  padding: 8px 14px; font-size: 14px; cursor: pointer; font-weight: 550;
}
button:disabled { opacity: 0.35; cursor: default; }
button:hover:not(:disabled) { filter: brightness(1.12); }
button.secondary { background: #2a2433; color: var(--text); }
button.secondary:hover:not(:disabled) { background: #362e42; filter: none; }
.btnlink {
  display: inline-block; background-image: var(--grad); color: #fff; text-decoration: none;
  border-radius: 8px; padding: 8px 14px; font-size: 14px; font-weight: 550;
}
.btnlink:hover { filter: brightness(1.12); }
.card { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 16px; }
.hint { font-size: 13px; color: var(--muted); }
.error { color: #ff7b72; font-size: 13px; }
h2 {
  font-size: 14px; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--muted); margin: 0 0 12px;
}
.shell { display: flex; height: 100vh; }
aside {
  width: 200px; flex: none; border-right: 1px solid var(--border);
  display: flex; flex-direction: column; padding: 18px 12px;
}
.brand { display: flex; align-items: center; gap: 10px; padding: 0 8px 18px; }
.brand img { width: 34px; height: 34px; border-radius: 9px; display: block; }
.brand span {
  font-size: 16px; font-weight: 700; letter-spacing: -0.01em;
  background: var(--grad); -webkit-background-clip: text; background-clip: text;
  color: transparent;
}
nav { display: flex; flex-direction: column; gap: 2px; overflow-y: auto; min-height: 0; margin: 0 -4px; padding: 0 4px; }
.nav-item {
  background: none; color: var(--muted); text-align: left; border-radius: 8px;
  padding: 9px 12px; font-size: 14px; font-weight: 500;
  display: flex; align-items: center; gap: 8px;
}
.nav-item:hover { background: var(--panel); color: var(--text); filter: none; }
.nav-item.active { background: var(--panel); color: var(--text); font-weight: 600; }
.nav-pls { display: flex; flex-direction: column; gap: 1px; margin: 1px 0 3px; }
.nav-pl {
  background: none; color: var(--muted); text-align: left; border-radius: 7px;
  padding: 6px 10px 6px 27px; font-size: 13px; font-weight: 450;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.nav-pl:hover { background: var(--panel); color: var(--text); filter: none; }
.nav-pl.active { background: var(--panel); color: var(--accent); font-weight: 600; }
.nav-badge {
  margin-left: auto; background-image: var(--grad); color: #fff; font-size: 10px;
  font-weight: 700; border-radius: 999px; min-width: 16px; height: 16px;
  display: inline-flex; align-items: center; justify-content: center; padding: 0 4px;
}
.side-foot { margin-top: auto; display: flex; align-items: center; gap: 8px; padding: 8px; font-size: 12px; color: var(--muted); }
.status-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.status-dot.ok { background: #56d364; }
.status-dot.bad { background: #ff7b72; }
.status-dot.ext { background: #e3b341; }
.side-face { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.body { flex: 1; display: flex; flex-direction: row; min-width: 0; }
.content { flex: 1; display: flex; flex-direction: column; min-width: 0; }
main { flex: 1; overflow-y: auto; padding: 16px 30px 24px; }
/* Playlist detail: main stops scrolling and hands its full height to the
   view, which splits into a fixed header band + internally-scrolling list.
   Sticky headers misbehave against this padding in WKWebView (rows peek
   above the parked header); with no shared scroller it's structurally
   impossible. The view supplies its own 30px side padding in this mode. */
main.flush { overflow: hidden; padding: 0; display: flex; flex-direction: column; }

/* --- motion: quick, soft, never showy --- */
.view-enter-active { transition: opacity 0.16s ease, transform 0.16s ease; }
.view-leave-active { transition: opacity 0.12s ease; }
.view-enter-from { opacity: 0; transform: translateY(6px); }
.view-leave-to { opacity: 0; }
.bar-enter-active, .bar-leave-active { transition: transform 0.22s cubic-bezier(0.22, 0.61, 0.36, 1), opacity 0.22s ease; }
.bar-enter-from, .bar-leave-to { transform: translateY(100%); opacity: 0; }
/* Slide by animating the real width: the content pane flexes along with it
   instead of snapping when the panel unmounts. !important beats the inline
   width binding on the from/to frames; the panel clips, rows hold their width. */
.panel-enter-active, .panel-leave-active {
  transition: width 0.22s cubic-bezier(0.22, 0.61, 0.36, 1), opacity 0.18s ease;
  overflow: hidden;
}
.panel-enter-from, .panel-leave-to { width: 0 !important; opacity: 0; }
.modal-enter-active, .modal-leave-active { transition: opacity 0.16s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
.modal-enter-active .modal, .modal-leave-active .modal { transition: transform 0.16s cubic-bezier(0.22, 0.61, 0.36, 1); }
.modal-enter-from .modal, .modal-leave-to .modal { transform: scale(0.97); }
@media (prefers-reduced-motion: reduce) {
  .view-enter-active, .view-leave-active, .bar-enter-active, .bar-leave-active,
  .panel-enter-active, .panel-leave-active, .modal-enter-active, .modal-leave-active { transition: none; }
}
</style>
