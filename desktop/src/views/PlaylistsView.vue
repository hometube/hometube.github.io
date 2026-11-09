<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { open as pickFolder } from "@tauri-apps/plugin-dialog";
import { api, currentUser, healthy, refreshPlaylists, state } from "../store";
import { enqueueNext, enqueueTracks, playList, player, toggleShuffle } from "../player";
import AddMusicModal from "../components/AddMusicModal.vue";
import MenuPopover from "../components/MenuPopover.vue";
import MenuIcon from "../components/MenuIcon.vue";
import ConfirmModal from "../components/ConfirmModal.vue";
import RenameModal from "../components/RenameModal.vue";

const playlists = ref([]);
const musicById = ref(new Map());
const videoById = ref(new Map());
const showAdd = ref(false);
const showDelete = ref(false);
const showRename = ref(false);
const exporting = ref(""); // set while an export runs; shows in the header hint
const toastMsg = ref("");
let toastTimer = null;
const addDest = ref(0); // 0 = library, preselected playlist when opened from a detail
let timer = null;

const user = computed(() => currentUser());
const selected = computed(() =>
  playlists.value.find((p) => p.id === state.openPlaylistId) || null
);
const isVideoList = computed(() => selected.value?.kind === "video");

const items = computed(() => {
  if (!selected.value) return [];
  const source = isVideoList.value ? videoById.value : musicById.value;
  return (selected.value.songs || [])
    .map((s) => source.get(s.music_id ?? s.video_id))
    .filter(Boolean);
});

const playingId = computed(() => player.queue[player.order[player.orderPos]]?.id ?? null);

async function load() {
  if (!healthy() || !user.value) {
    playlists.value = [];
    return;
  }
  try {
    const [p, m, v] = await Promise.all([
      api(`/api/playlists?user_id=${user.value.id}`),
      api("/api/music"),
      api("/api/videos?filter=all"),
    ]);
    playlists.value = p;
    musicById.value = new Map(m.map((x) => [x.id, x]));
    videoById.value = new Map(v.map((x) => [x.id, x]));
  } catch {
    /* server may be restarting */
  }
}

function playAll(start = 0) {
  if (isVideoList.value || !items.value.length) return;
  playList(items.value, start);
}

function shufflePlay() {
  if (!player.shuffle) toggleShuffle();
  playAll(Math.floor(Math.random() * items.value.length));
}

async function removeItem(id) {
  await api(`/api/playlists/${selected.value.id}/remove/${id}`, { method: "DELETE" });
  await load();
}

function openAdd(dest) {
  addDest.value = dest;
  showAdd.value = true;
}

// --- toasts ---
function toast(msg) {
  toastMsg.value = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastMsg.value = ""), 6000);
}

// --- queue (mirrors the mobile playlist/song menus) ---
function addAllToQueue() {
  const n = enqueueTracks(items.value);
  if (n) state.queueOpen = true;
  toast(n ? `Added ${n} item${n === 1 ? "" : "s"} to the queue.` : "Everything here is already in the queue.");
}

function shuffleAddQueue() {
  const list = items.value.slice();
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  const n = enqueueTracks(list);
  if (n) state.queueOpen = true;
  toast(n ? `Added ${n} shuffled item${n === 1 ? "" : "s"} to the queue.` : "Everything here is already in the queue.");
}

function addSongToQueue(t) {
  const n = enqueueTracks([t]);
  if (n) state.queueOpen = true;
  toast(n ? `Added “${t.title || "Untitled"}” to the queue.` : `“${t.title || "Untitled"}” is already in the queue.`);
}

function playNextSong(t) {
  if (enqueueNext(t)) toast(`Playing “${t.title || "Untitled"}” next.`);
  else toast(`“${t.title || "Untitled"}” is already in the queue.`);
}

// --- export: copy files to a folder under real song names ---
function sanitizeName(s) {
  const clean = String(s || "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.+$/, "");
  return clean.slice(0, 180);
}

function exportName(t, kind) {
  // Extension from the file on disk when known, per-kind fallback otherwise.
  const srcName =
    t.filename ||
    (String(t.url || "").startsWith("file://")
      ? decodeURIComponent(String(t.url).slice(7).split(/[\\/]/).pop())
      : "");
  const ext =
    /\.([A-Za-z0-9]{1,5})$/.exec(srcName || "")?.[1]?.toLowerCase() ||
    (kind === "music" ? "mp3" : "mp4");
  // Titles can carry the file extension themselves (imported files).
  const stripExt = (s) => s.replace(new RegExp(`\\.${ext}$`, "i"), "");
  const base =
    sanitizeName(kind === "music" ? [t.artist, t.title].filter(Boolean).join(" - ") : t.title) ||
    sanitizeName(stripExt(srcName)) ||
    `Track ${t.id}`;
  return `${stripExt(base)}.${ext}`;
}

function dedupeNames(names) {
  const seen = new Set();
  return names.map((n) => {
    let out = n;
    for (let i = 2; seen.has(out.toLowerCase()); i++) {
      const dot = n.lastIndexOf(".");
      out = dot > 0 ? `${n.slice(0, dot)} (${i})${n.slice(dot)}` : `${n} (${i})`;
    }
    seen.add(out.toLowerCase());
    return out;
  });
}

async function exportTo(list, kind) {
  if (!list.length || exporting.value) return;
  const dest = await pickFolder({
    directory: true,
    title: `Export ${list.length} ${kind === "music" ? "song" : "file"}${list.length === 1 ? "" : "s"} to…`,
  });
  if (!dest) return;
  exporting.value = `Exporting ${list.length} file${list.length === 1 ? "" : "s"}…`;
  const names = dedupeNames(list.map((t) => exportName(t, kind)));
  const payload = list.map((t, i) => ({
    kind,
    filename: t.filename || null,
    url: t.url || null,
    videoId: t.video_id || null,
    name: names[i],
  }));
  try {
    const res = await invoke("export_items", { destDir: dest, items: payload });
    toast(
      res.failed.length
        ? `Exported ${res.copied} of ${list.length} — not downloaded yet: ${res.failed.join(", ")}`
        : `Exported ${res.copied} file${res.copied === 1 ? "" : "s"} to ${dest}`
    );
  } catch (e) {
    toast(`Export failed: ${e}`);
  } finally {
    exporting.value = "";
  }
}

const listKind = () => (isVideoList.value ? "videos" : "music");

// --- playlist rename / delete ---
async function renameTo(name) {
  showRename.value = false;
  try {
    await api(`/api/playlists/${selected.value.id}`, {
      method: "PUT",
      body: JSON.stringify({ name }),
    });
    await load();
    refreshPlaylists();
    toast(`Renamed to “${name}”.`);
  } catch (e) {
    toast(`Rename failed (${e.message}).`);
  }
}

async function deletePlaylist() {
  const name = selected.value?.name;
  showDelete.value = false;
  try {
    await api(`/api/playlists/${selected.value.id}`, { method: "DELETE" });
    state.openPlaylistId = null;
    await load();
    refreshPlaylists();
    toast(`Deleted “${name}”. The songs are still in your library.`);
  } catch (e) {
    toast(`Delete failed (${e.message}).`);
  }
}

// id, not the object: periodic refreshUsers() churns the object identity
// and would otherwise reload the list on every poll.
watch(() => user.value?.id, load);
onMounted(() => {
  load();
  timer = setInterval(load, 8000);
});
onUnmounted(() => {
  clearInterval(timer);
  clearTimeout(toastTimer);
});
</script>

<template>
  <div v-if="!selected">
    <div class="list-head">
      <h2>Music</h2>
      <button class="add-music" @click="openAdd(0)">+ Add music</button>
    </div>
    <div v-if="playlists.length" class="cards">
      <div v-for="p in playlists" :key="p.id" class="card" @click="state.openPlaylistId = p.id">
        <strong>{{ p.name }}</strong>
        <small class="hint">
          {{ p.kind === "video" ? "Videos" : "Music" }} ·
          {{ (p.songs || []).length }}
          {{ (p.songs || []).length === 1 ? "item" : "items" }}
        </small>
      </div>
    </div>
    <p v-else class="hint">
      No playlists for {{ user?.username || "you" }} yet. Use
      <em>+ Add music</em> — paste a playlist URL or pick <em>As a new
      playlist</em> to create one.
    </p>
  </div>

  <div v-else class="detail">
    <div class="detail-head">
      <template v-if="!isVideoList">
        <button class="big-play" :disabled="!items.length" title="Play" @click="playAll(0)">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="#fff"
            ><path d="M8 5v14l11-7z" /></svg>
        </button>
        <button
          class="shuffle-btn"
          :class="{ on: player.shuffle }"
          :disabled="!items.length"
          title="Shuffle play"
          @click="shufflePlay"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"
            ><path
              d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 8.46 20 10.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"
            /></svg>
        </button>
      </template>
      <div class="head-text">
        <h2 class="pl-name">{{ selected.name }}</h2>
        <p class="hint">{{ exporting || `${items.length} ${items.length === 1 ? "item" : "items"}` }}</p>
      </div>
      <!-- Overflow menu sits at the far side of the transport buttons so its
           popover opens leftward over the content, never behind the sidebar. -->
      <div class="head-actions">
        <button
          v-if="!isVideoList"
          class="secondary add-music"
          @click="openAdd(selected.id)"
        >
          + Add music
        </button>
        <MenuPopover>
          <template v-if="!isVideoList">
            <button :disabled="!items.length || !!exporting" @click="addAllToQueue">
              <MenuIcon name="add" /> Add to Queue
            </button>
            <button :disabled="!items.length || !!exporting" @click="shuffleAddQueue">
              <MenuIcon name="shuffle" /> Shuffle and Add to Queue
            </button>
          </template>
          <button :disabled="!items.length || !!exporting" @click="exportTo(items, listKind())">
            <MenuIcon name="download" /> Export…
          </button>
          <button @click="showRename = true">
            <MenuIcon name="pencil" /> Rename…
          </button>
          <button class="danger" @click="showDelete = true">
            <MenuIcon name="trash" /> Delete Playlist
          </button>
        </MenuPopover>
      </div>
    </div>

    <p v-if="isVideoList" class="hint padded">
      Video playback on desktop arrives with the next release.
    </p>

    <div v-else-if="items.length" class="rows-scroll">
      <div class="rows">
        <div
          v-for="(t, i) in items"
          :key="t.id"
          class="row-item"
          :class="{ playing: t.id === playingId }"
          @click="playAll(i)"
        >
          <span class="thumb" :class="{ art: !!t.album_art }">
            <img v-if="t.album_art" :src="t.album_art" loading="lazy" alt="" />
            <svg v-else viewBox="0 0 24 24" width="15" height="15" fill="rgba(255,255,255,.92)"
              ><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" /></svg>
            <span class="go">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="#fff"
                ><path d="M8 5v14l11-7z" /></svg>
            </span>
          </span>
          <span class="title" :title="t.title">{{ t.title || "Untitled" }}</span>
          <span class="artist">{{ t.artist || "—" }}</span>
          <MenuPopover class="row-menu">
            <button @click="playAll(i)">
              <MenuIcon name="play" /> Play Now
            </button>
            <button @click="playNextSong(t)">
              <MenuIcon name="playNext" /> Play Next
            </button>
            <button @click="addSongToQueue(t)">
              <MenuIcon name="add" /> Add to Queue
            </button>
            <button :disabled="!!exporting" @click="exportTo([t], listKind())">
              <MenuIcon name="download" /> Export…
            </button>
            <button class="danger" @click="removeItem(t.id)">
              <MenuIcon name="trash" /> Remove from Playlist
            </button>
          </MenuPopover>
        </div>
      </div>
    </div>
    <p v-else class="hint padded">This playlist is empty.</p>
  </div>

  <AddMusicModal
    v-if="showAdd"
    :initial-playlist="addDest"
    @close="showAdd = false"
    @added="load"
  />

  <RenameModal
    v-if="showRename && selected"
    :name="selected.name"
    @save="renameTo"
    @close="showRename = false"
  />

  <ConfirmModal
    v-if="showDelete && selected"
    title="Delete playlist"
    :message="`Delete “${selected.name}”? The songs stay in your library.`"
    confirm-label="Delete"
    danger
    @confirm="deletePlaylist"
    @close="showDelete = false"
  />

  <div v-if="toastMsg" class="toast">{{ toastMsg }}</div>
</template>

<style scoped>
.list-head { display: flex; align-items: center; margin-bottom: 14px; }
.add-music { margin-left: auto; flex: none; }
/* Right-anchored group in the playlist header: Add music + overflow menu. */
.head-actions { margin-left: auto; display: flex; align-items: center; gap: 10px; flex: none; }
.head-actions .add-music { margin-left: 0; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
.card {
  padding: 16px; display: flex; flex-direction: column; gap: 5px; cursor: pointer;
  transition: border-color 0.15s ease;
}
.card:hover { border-color: #4b3f5a; }
.card strong { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Fixed header band: main.flush (App.vue) hands us the full viewport, the
   header sits above the list's scroll area, and only .rows-scroll scrolls.
   Rows physically cannot render above the band — no stickiness involved.
   Own 30px side padding matches main; z-index lifts the shadow over the
   list edge so content sliding under reads as depth. */
.detail {
  flex: 1; min-height: 0; display: flex; flex-direction: column;
}
.detail-head {
  position: relative; z-index: 2; background: var(--bg); flex: none;
  display: flex; align-items: center; gap: 14px;
  padding: 16px 30px 10px; margin: 0 0 6px;
  box-shadow: 0 10px 14px -12px rgba(0, 0, 0, 0.65);
}
/* The only scroller: rows start below the band and vanish below it. */
.rows-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 0 30px 24px; }
/* Hints in detail mode sit outside main's padding, so supply it. */
.padded { padding-left: 30px; padding-right: 30px; }
.head-text { min-width: 0; }
.pl-name { font-size: 20px; text-transform: none; letter-spacing: -0.01em; color: var(--text); margin: 0 0 2px; }
.head-text .hint { margin: 0; }
/* Gradient circle for Play so it pops; Shuffle stays a quiet ghost icon. */
.big-play {
  width: 42px; height: 42px; border: 0; border-radius: 50%; color: #fff; flex: none;
  background-image: var(--grad); display: inline-flex; align-items: center;
  justify-content: center; padding: 0;
}
.big-play:hover:not(:disabled) { background-image: var(--grad); color: #fff; filter: brightness(1.12); }
.shuffle-btn {
  width: 36px; height: 36px; background: none; border: 1px solid var(--border);
  border-radius: 50%; color: var(--muted); flex: none; display: inline-flex;
  align-items: center; justify-content: center; padding: 0;
  transition: border-color 0.15s ease, color 0.15s ease;
}
.shuffle-btn:hover:not(:disabled) { background: none; filter: none; border-color: var(--accent); color: var(--accent); }
.shuffle-btn.on { color: var(--accent); border-color: var(--accent); }
.rows { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; }
/* No overflow:hidden here: row popover menus must escape the list box.
   Row corners are rounded individually instead. */
.row-item:first-child { border-top-left-radius: 11px; border-top-right-radius: 11px; }
.row-item:last-child { border-bottom-left-radius: 11px; border-bottom-right-radius: 11px; }
.row-item {
  display: flex; align-items: center; gap: 12px; padding: 10px 14px;
  font-size: 14px; border-bottom: 1px solid var(--border); cursor: pointer;
}
.row-item:last-child { border-bottom: 0; }
.row-item:hover { background: var(--inset); }
.thumb {
  position: relative; width: 38px; height: 38px; border-radius: 7px; flex: none;
  overflow: hidden; display: inline-flex; align-items: center; justify-content: center;
  background: var(--inset);
}
.thumb.art { background: #000; }
.thumb:not(.art) { background-image: var(--grad); }
.thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.thumb .go {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.45); opacity: 0; border-radius: 0;
}
.row-item:hover .thumb .go, .row-item.playing .thumb .go { opacity: 1; }
.row-item.playing { color: var(--accent); }
.row-item .title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-item .artist { color: var(--muted); font-size: 13px; width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Toast: clears the transport bar (bottom) and stays put while actions run. */
.toast {
  position: fixed; left: 50%; transform: translateX(-50%); bottom: 96px; z-index: 60;
  background: var(--panel); border: 1px solid var(--border); border-radius: 10px;
  padding: 10px 16px; font-size: 13px; color: var(--text);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.5); max-width: min(560px, 90vw);
}
</style>
