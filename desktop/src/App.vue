<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { listen } from "@tauri-apps/api/event";
import {
  currentUser,
  healthy,
  navigate,
  refreshStatus,
  refreshStorage,
  refreshUsers,
  state,
  wizardDone,
} from "./store";
import { next, player, prev, toggle } from "./player";
import WizardView from "./views/WizardView.vue";
import HomeView from "./views/HomeView.vue";
import PlaylistsView from "./views/PlaylistsView.vue";
import VideosView from "./views/VideosView.vue";
import PodcastsView from "./views/PodcastsView.vue";
import DevicesView from "./views/DevicesView.vue";
import SettingsView from "./views/SettingsView.vue";
import TransportBar from "./components/TransportBar.vue";

const NAV = [
  { id: "home", label: "Home" },
  { id: "playlists", label: "Playlists" },
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
// faces added from the CLI or the mobile app).
watch(
  () => healthy(),
  (ok) => {
    if (ok) refreshUsers();
  }
);

let timers = [];
let unlisten = null;
let unlistenPlayer = null;
onMounted(async () => {
  refreshStatus();
  refreshStorage();
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
        <button
          v-for="n in NAV"
          :key="n.id"
          class="nav-item"
          :class="{ active: state.view === n.id }"
          @click="navigate(n.id)"
        >
          {{ n.label }}
        </button>
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
      <main>
        <component :is="view" />
      </main>
      <TransportBar v-if="player.queue.length" />
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
body { margin: 0; background: var(--bg); color: var(--text); }
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
nav { display: flex; flex-direction: column; gap: 2px; }
.nav-item {
  background: none; color: var(--muted); text-align: left; border-radius: 8px;
  padding: 9px 12px; font-size: 14px; font-weight: 500;
}
.nav-item:hover { background: var(--panel); color: var(--text); filter: none; }
.nav-item.active { background: var(--panel); color: var(--text); font-weight: 600; }
.side-foot { margin-top: auto; display: flex; align-items: center; gap: 8px; padding: 8px; font-size: 12px; color: var(--muted); }
.status-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.status-dot.ok { background: #56d364; }
.status-dot.bad { background: #ff7b72; }
.status-dot.ext { background: #e3b341; }
.side-face { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.body { flex: 1; display: flex; flex-direction: column; min-width: 0; }
main { flex: 1; overflow-y: auto; padding: 16px 30px 24px; }
</style>
