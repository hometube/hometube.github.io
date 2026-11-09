<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { api, apiBase, currentUser, healthy } from "../store";
import { fmtLong, pauseMusic } from "../player";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "unwatched", label: "Unwatched" },
  { id: "keep", label: "Keep" },
];

const videos = ref([]);
const filter = ref("all");
const current = ref(null); // detail row
const videoEl = ref(null);
let flushTimer = null;
let pollTimer = null;

const user = computed(() => currentUser());
const videoSrc = computed(() =>
  current.value ? `${apiBase()}/api/videos/${current.value.id}/file` : null
);

async function load() {
  if (!healthy() || !user.value) {
    videos.value = [];
    return;
  }
  try {
    videos.value = await api(
      `/api/videos?user_id=${user.value.id}&filter=${filter.value}`
    );
    if (current.value) {
      // keep the detail row in sync with server state
      const fresh = videos.value.find((v) => v.id === current.value.id);
      if (fresh) current.value = fresh;
    }
  } catch {
    /* server may be restarting */
  }
}

function open(v) {
  pauseMusic();
  current.value = v;
}

async function closeDetail() {
  await flush();
  current.value = null;
}

async function flush() {
  const el = videoEl.value;
  if (!el || !current.value) return;
  if (el.paused || !Number.isFinite(el.currentTime) || el.currentTime < 2) return;
  if (el.ended || (el.duration && el.currentTime / el.duration > 0.95)) {
    await api(`/api/videos/${current.value.id}/watch`, {
      method: "POST",
      body: JSON.stringify({ watched: true, position: 0 }),
    }).catch(() => {});
  } else {
    await api(`/api/videos/${current.value.id}/watch`, {
      method: "POST",
      body: JSON.stringify({ position: Math.floor(el.currentTime) }),
    }).catch(() => {});
  }
}

function onEnded() {
  const id = current.value?.id;
  if (!id) return;
  api(`/api/videos/${id}/watch`, {
    method: "POST",
    body: JSON.stringify({ watched: true, position: 0 }),
  }).then(() => load());
}

async function toggleWatched(v) {
  const watched = v.watched_at != null;
  await api(`/api/videos/${v.id}/watch`, {
    method: "POST",
    body: JSON.stringify({ watched: !watched }),
  });
  await load();
}

async function toggleKeep(v) {
  await api(`/api/videos/${v.id}/keep`, {
    method: "POST",
    body: JSON.stringify({ keep: !v.keep_flag }),
  });
  await load();
}

async function remove(v) {
  if (current.value?.id === v.id) current.value = null;
  await api(`/api/videos/${v.id}`, { method: "DELETE" });
  await load();
}

function resumePct(v) {
  if (!v.position || !v.duration || v.watched_at) return 0;
  return Math.min(100, (v.position / v.duration) * 100);
}

// id, not the object: periodic refreshUsers() churns the object identity
// and would otherwise kick the player back to the feed.
watch(() => user.value?.id, () => {
  current.value = null;
  load();
});
watch(filter, load);
onMounted(() => {
  load();
  flushTimer = setInterval(flush, 30000);
  pollTimer = setInterval(load, 15000);
});
onUnmounted(() => {
  clearInterval(flushTimer);
  clearInterval(pollTimer);
  flush();
});
</script>

<template>
  <div v-if="!current">
    <div class="head">
      <h2>Videos</h2>
      <div class="chips">
        <button
          v-for="f in FILTERS"
          :key="f.id"
          class="chip"
          :class="{ on: filter === f.id }"
          @click="filter = f.id"
        >
          {{ f.label }}
        </button>
      </div>
    </div>
    <div v-if="videos.length" class="grid">
      <div v-for="v in videos" :key="v.id" class="v-card" @click="open(v)">
        <div class="thumb">
          <img v-if="v.thumbnail" :src="v.thumbnail" loading="lazy" alt="" @error="$event.target.remove()" />
          <span v-if="v.duration" class="dur">{{ fmtLong(v.duration) }}</span>
          <span v-if="v.watched_at" class="watched">Watched</span>
          <span v-if="v.keep_flag" class="keep" title="Keeping">•</span>
          <span class="resume" :style="{ width: resumePct(v) + '%' }" />
          <span class="go">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="#fff"
              ><path d="M8 5v14l11-7z" /></svg>
          </span>
        </div>
        <div class="v-title" :title="v.title">{{ v.title || "Untitled" }}</div>
      </div>
    </div>
    <p v-else class="hint">
      No videos here yet. Add one with
      <code>ht download &lt;url&gt;</code> or the mobile app.
    </p>
  </div>

  <div v-else class="detail">
    <div class="head">
      <button class="secondary back" @click="closeDetail">← Back</button>
      <div class="head-actions">
        <button class="secondary" @click.stop="toggleKeep(current)">
          {{ current.keep_flag ? "Unkeep" : "Keep" }}
        </button>
        <button class="secondary" @click.stop="toggleWatched(current)">
          {{ current.watched_at ? "Unwatch" : "Mark watched" }}
        </button>
        <button class="danger" @click.stop="remove(current)">Delete</button>
      </div>
    </div>
    <video
      ref="videoEl"
      class="player"
      controls
      autoplay
      :src="videoSrc"
      @ended="onEnded"
    />
    <h3 class="v-head-title">{{ current.title || "Untitled" }}</h3>
    <p v-if="!current.filename" class="hint">
      Not downloaded yet — the server is fetching it now; playback starts when
      it is ready.
    </p>
  </div>
</template>

<style scoped>
.head { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
.head h2 { margin: 0; }
.chips { display: flex; gap: 6px; }
.chip {
  background: var(--panel); color: var(--muted); border: 1px solid var(--border);
  border-radius: 999px; padding: 4px 12px; font-size: 12px; font-weight: 500;
}
.chip:hover { background: var(--panel); color: var(--text); filter: none; }
.chip.on { background-image: var(--grad); color: #fff; border-color: transparent; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
.v-card { cursor: pointer; }
.thumb {
  position: relative; aspect-ratio: 16/9; border-radius: 10px; overflow: hidden;
  background: var(--panel) center/cover;
  border: 1px solid var(--border);
}
.thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.dur {
  position: absolute; right: 6px; bottom: 6px; background: rgba(0, 0, 0, 0.75);
  color: #fff; font-size: 11px; padding: 1px 6px; border-radius: 4px;
}
.watched {
  position: absolute; left: 6px; top: 6px; background: rgba(0, 0, 0, 0.75);
  color: var(--muted); font-size: 10px; text-transform: uppercase;
  letter-spacing: 0.05em; padding: 2px 6px; border-radius: 4px;
}
.keep {
  position: absolute; right: 6px; top: 2px; color: var(--accent); font-size: 18px;
}
.resume {
  position: absolute; left: 0; bottom: 0; height: 3px;
  background-image: var(--grad);
}
.go {
  position: absolute; inset: 0; display: flex; align-items: center;
  justify-content: center; background: rgba(0, 0, 0, 0.25);
  opacity: 0; transition: opacity 0.15s;
}
.v-card:hover .go { opacity: 1; }
.v-title {
  font-size: 13px; margin-top: 8px; line-height: 1.4;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden;
}
.detail .player {
  width: 100%; max-height: 62vh; border-radius: 12px; background: #000;
  display: block;
}
.v-head-title { font-size: 16px; margin: 12px 0 4px; }
.head-actions { display: flex; gap: 8px; }
button.danger { background: #3a2030; color: #ff9aa5; }
button.danger:hover { background: #4a2434; filter: none; }
.back { flex: none; }
code { background: var(--inset); border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; }
</style>
