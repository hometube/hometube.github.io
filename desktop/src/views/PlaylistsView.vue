<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { api, currentUser, healthy, state } from "../store";
import { playList, player, toggleShuffle } from "../player";

const playlists = ref([]);
const musicById = ref(new Map());
const videoById = ref(new Map());
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

watch(user, load);
onMounted(() => {
  load();
  timer = setInterval(load, 8000);
});
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <div v-if="!selected">
    <h2>Music</h2>
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
      No playlists for {{ user?.username || "you" }} yet. Adding a playlist
      URL creates one automatically.
    </p>
  </div>

  <div v-else>
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
        <p class="hint">{{ items.length }} {{ items.length === 1 ? "item" : "items" }}</p>
      </div>
    </div>

    <p v-if="isVideoList" class="hint">
      Video playback on desktop arrives with the next release.
    </p>

    <div v-else-if="items.length" class="rows">
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
        <button class="remove" title="Remove from playlist" @click.stop="removeItem(t.id)">
          ×
        </button>
      </div>
    </div>
    <p v-else class="hint">This playlist is empty.</p>
  </div>
</template>

<style scoped>
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
.card {
  padding: 16px; display: flex; flex-direction: column; gap: 5px; cursor: pointer;
  transition: border-color 0.15s ease;
}
.card:hover { border-color: #4b3f5a; }
.card strong { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Sticky while the rows scroll. No negative margin: with top:0 a negative
   margin edge parks the visible background a few px below the top, leaving
   rows peeking through above it. Solid bg, flush parking, soft shadow so
   content sliding under it reads as intentional depth. */
.detail-head {
  position: sticky; top: 0; z-index: 2; background: var(--bg);
  display: flex; align-items: center; gap: 14px;
  padding: 12px 0 10px; margin: 0 0 6px;
  box-shadow: 0 10px 14px -12px rgba(0, 0, 0, 0.65);
}
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
.rows { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
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
.remove {
  background: none; color: var(--muted); font-size: 16px; padding: 2px 8px;
  border-radius: 6px; opacity: 0; flex: none;
}
.row-item:hover .remove { opacity: 1; }
.remove:hover { color: #ff7b72; background: none; filter: none; }
</style>
