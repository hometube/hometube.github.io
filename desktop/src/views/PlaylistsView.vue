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
    <h2>Playlists</h2>
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
    <button class="secondary back" @click="state.openPlaylistId = null">← Back</button>
    <div class="detail-head">
      <div>
        <h2 class="pl-name">{{ selected.name }}</h2>
        <p class="hint">{{ items.length }} {{ items.length === 1 ? "item" : "items" }}</p>
      </div>
      <div class="head-actions" v-if="!isVideoList">
        <button :disabled="!items.length" @click="playAll(0)">Play</button>
        <button class="secondary" :disabled="!items.length" @click="shufflePlay">
          Shuffle
        </button>
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
        <span class="go">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"
            ><path d="M8 5v14l11-7z" /></svg>
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
.back { margin-bottom: 16px; }
.detail-head { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 16px; gap: 16px; }
.pl-name { font-size: 20px; text-transform: none; letter-spacing: -0.01em; color: var(--text); margin: 0 0 4px; }
.head-actions { display: flex; gap: 10px; flex: none; }
.rows { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
.row-item {
  display: flex; align-items: center; gap: 12px; padding: 10px 14px;
  font-size: 14px; border-bottom: 1px solid var(--border); cursor: pointer;
}
.row-item:last-child { border-bottom: 0; }
.row-item:hover { background: var(--inset); }
.row-item .go { color: var(--muted); display: inline-flex; width: 16px; flex: none; opacity: 0; }
.row-item:hover .go, .row-item.playing .go { opacity: 1; }
.row-item.playing { color: var(--accent); }
.row-item.playing .go { color: var(--accent); }
.row-item .title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-item .artist { color: var(--muted); font-size: 13px; width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.remove {
  background: none; color: var(--muted); font-size: 16px; padding: 2px 8px;
  border-radius: 6px; opacity: 0; flex: none;
}
.row-item:hover .remove { opacity: 1; }
.remove:hover { color: #ff7b72; background: none; filter: none; }
</style>
