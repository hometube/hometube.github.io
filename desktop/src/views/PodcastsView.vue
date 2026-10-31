<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { api, currentUser, healthy } from "../store";
import { fmtLong, playList } from "../player";

const feeds = ref([]);
const standalone = ref([]);
const detail = ref(null); // { subscription_id, channel_name, episodes }
const checking = ref(false);
let pollTimer = null;

const user = computed(() => currentUser());

async function load() {
  if (!healthy() || !user.value) {
    feeds.value = [];
    standalone.value = [];
    return;
  }
  try {
    const [f, e] = await Promise.all([
      api(`/api/podcasts?user_id=${user.value.id}`),
      api(`/api/podcasts/episodes?user_id=${user.value.id}`),
    ]);
    feeds.value = f;
    standalone.value = e;
  } catch {
    /* server may be restarting */
  }
}

async function openFeed(feed) {
  try {
    detail.value = await api(`/api/podcasts/${feed.subscription_id}/episodes`);
  } catch {
    /* stay on the list */
  }
}

async function checkFeed(subId) {
  checking.value = true;
  try {
    await api(`/api/podcasts/${subId}/check`, { method: "POST" });
    await load();
    if (detail.value?.subscription_id === subId) await openFeed({ subscription_id: subId });
  } finally {
    checking.value = false;
  }
}

async function unsubscribe(subId) {
  await api(`/api/podcasts/${subId}`, { method: "DELETE" });
  detail.value = null;
  await load();
}

function playEpisodes(list, i) {
  playList(list, i);
}

watch(user, () => {
  detail.value = null;
  load();
});
onMounted(() => {
  load();
  pollTimer = setInterval(load, 15000);
});
onUnmounted(() => clearInterval(pollTimer));
</script>

<template>
  <div v-if="!detail">
    <h2>Podcasts</h2>

    <div v-if="feeds.length" class="rows">
      <div v-for="f in feeds" :key="f.subscription_id" class="row-item" @click="openFeed(f)">
        <span class="p-name" :title="f.channel_url">{{ f.channel_name || "Untitled feed" }}</span>
        <span class="p-count">{{ f.downloaded_count }}/{{ f.episode_count }}</span>
      </div>
    </div>

    <template v-if="standalone.length">
      <h2 class="single-title">Standalone episodes</h2>
      <div class="rows">
        <div
          v-for="(e, i) in standalone"
          :key="e.id"
          class="row-item"
          @click="playEpisodes(standalone, i)"
        >
          <span class="thumb" :class="{ art: !!e.album_art }">
            <img v-if="e.album_art" :src="e.album_art" loading="lazy" alt="" />
            <svg v-else viewBox="0 0 24 24" width="15" height="15" fill="rgba(255,255,255,.92)"
              ><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" /></svg>
            <span class="go">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="#fff"
                ><path d="M8 5v14l11-7z" /></svg>
            </span>
          </span>
          <span class="p-name" :title="e.title">{{ e.title || "Untitled" }}</span>
          <span class="dot-state" :class="{ on: e.filename }" />
        </div>
      </div>
    </template>

    <p v-if="!feeds.length && !standalone.length" class="hint">
      No podcasts yet. Subscribe from the mobile app or
      <code>POST /api/podcasts/subscribe</code>; single downloads show up as
      standalone episodes.
    </p>
  </div>

  <div v-else>
    <div class="head">
      <button class="secondary back" @click="detail = null">← Back</button>
      <div class="head-actions">
        <button class="secondary" :disabled="checking" @click="checkFeed(detail.subscription_id)">
          {{ checking ? "Checking…" : "Check now" }}
        </button>
        <button class="danger" @click="unsubscribe(detail.subscription_id)">Unsubscribe</button>
      </div>
    </div>
    <h3 class="feed-name">{{ detail.channel_name }}</h3>
    <div v-if="detail.episodes.length" class="rows">
      <div
        v-for="(e, i) in detail.episodes"
        :key="e.id"
        class="row-item"
        @click="playEpisodes(detail.episodes, i)"
      >
        <span class="thumb" :class="{ art: !!e.album_art }">
          <img v-if="e.album_art" :src="e.album_art" loading="lazy" alt="" />
          <svg v-else viewBox="0 0 24 24" width="15" height="15" fill="rgba(255,255,255,.92)"
            ><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" /></svg>
          <span class="go">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="#fff"
              ><path d="M8 5v14l11-7z" /></svg>
          </span>
        </span>
        <span class="p-name" :title="e.title">{{ e.title || "Untitled" }}</span>
        <span class="p-count">{{ fmtLong(e.duration) }}</span>
        <span class="dot-state" :class="{ on: e.filename }" :title="e.filename ? 'On disk' : 'Not downloaded'" />
      </div>
    </div>
    <p v-else class="hint">No episodes yet — try “Check now”.</p>
  </div>
</template>

<style scoped>
.head { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 10px; }
.head-actions { display: flex; gap: 8px; }
.back { flex: none; }
.single-title { margin-top: 26px; }
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
.row-item:hover .thumb .go { opacity: 1; }
.p-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.p-count { color: var(--muted); font-size: 12px; flex: none; font-variant-numeric: tabular-nums; }
.dot-state { width: 8px; height: 8px; border-radius: 50%; background: var(--border); flex: none; }
.dot-state.on { background: #56d364; }
.feed-name { font-size: 18px; margin: 0 0 12px; }
button.danger { background: #3a2030; color: #ff9aa5; }
button.danger:hover { background: #4a2434; filter: none; }
code { background: var(--inset); border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; }
</style>
