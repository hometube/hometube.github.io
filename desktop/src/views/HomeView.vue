<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import {
  api,
  currentUser,
  healthy,
  openPlaylist,
  refreshUsers,
  setCurrentUser,
  state,
} from "../store";
import { playList, player } from "../player";
import FaceAvatar from "../components/FaceAvatar.vue";
import AddMusicModal from "../components/AddMusicModal.vue";

const music = ref([]);
const playlists = ref([]);
const jobs = ref([]);
const adding = ref(false);
const showAdd = ref(false);
const name = ref("");
const error = ref("");
let timer = null;

const user = computed(() => currentUser());
const activeJobs = computed(() =>
  jobs.value.filter((j) => j.status === "queued" || j.status === "running")
);
const recent = computed(() => music.value.slice(0, 8));

async function load() {
  if (!healthy() || !user.value) {
    music.value = [];
    playlists.value = [];
    return;
  }
  try {
    const [m, p, j] = await Promise.all([
      api(`/api/music?user_id=${user.value.id}`),
      api(`/api/playlists?user_id=${user.value.id}`),
      api("/api/downloads"),
    ]);
    music.value = m.filter((x) => x.kind !== "podcast");
    playlists.value = p;
    jobs.value = j;
  } catch {
    /* server may be restarting */
  }
}

async function addFace() {
  const username = name.value.trim();
  if (!username || adding.value) return;
  adding.value = true;
  error.value = "";
  try {
    const created = await api("/api/users", {
      method: "POST",
      body: JSON.stringify({ username }),
    });
    await refreshUsers();
    if (created?.id) setCurrentUser(created.id);
    name.value = "";
    adding.value = false;
    load();
    return;
  } catch (e) {
    error.value = String(e);
  }
  adding.value = false;
}

watch(user, load);
onMounted(() => {
  load();
  timer = setInterval(load, 5000);
});
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <div class="home">
    <section class="faces">
      <button
        v-for="u in state.users"
        :key="u.id"
        class="face-btn"
        :class="{ active: user && u.id === user.id }"
        @click="setCurrentUser(u.id)"
      >
        <FaceAvatar :name="u.username" :size="30" />
        <span>{{ u.username }}</span>
      </button>
      <button class="face-btn add" title="Add a face" @click="adding = !adding">
        <span class="plus">+</span>
        <span>Add</span>
      </button>
      <button class="add-music" @click="showAdd = true">+ Add music</button>
    </section>
    <form v-if="adding" class="row" @submit.prevent="addFace">
      <input v-model="name" placeholder="Their name" maxlength="40" autofocus />
      <button type="submit" :disabled="!name.trim() || adding">Add</button>
      <button class="secondary" type="button" @click="adding = false">Cancel</button>
    </form>
    <p v-if="error" class="error">{{ error }}</p>

    <template v-if="!state.users.length">
      <div class="empty">
        <h3>No faces yet</h3>
        <p class="hint">Add someone above to start building their library.</p>
      </div>
    </template>

    <template v-else>
      <section class="shelf">
        <h2>Recently added</h2>
        <div v-if="recent.length" class="rows">
          <div
            v-for="(m, i) in recent"
            :key="m.id"
            class="row-item"
            :class="{ playing: player.queue[player.order[player.orderPos]]?.id === m.id }"
            @click="playList(music, i)"
          >
            <span class="thumb" :class="{ art: !!m.album_art }">
              <img v-if="m.album_art" :src="m.album_art" loading="lazy" alt="" />
              <svg v-else viewBox="0 0 24 24" width="15" height="15" fill="rgba(255,255,255,.92)"
                ><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" /></svg>
              <span class="go">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="#fff"
                  ><path d="M8 5v14l11-7z" /></svg>
              </span>
            </span>
            <span class="title" :title="m.title">{{ m.title || "Untitled" }}</span>
            <span class="artist">{{ m.artist || "—" }}</span>
            <span class="dot-state" :class="{ on: m.filename }" :title="m.filename ? 'On disk' : 'Downloading — playback waits for it'" />
          </div>
        </div>
        <p v-else class="hint">
          Nothing yet for {{ user?.username }}. Hit
          <strong>+ Add music</strong> above and paste a YouTube link.
        </p>
      </section>

      <section class="shelf">
        <h2>Your playlists</h2>
        <div v-if="playlists.length" class="cards">
          <div
            v-for="p in playlists"
            :key="p.id"
            class="pl-card"
            @click="openPlaylist(p.id)"
          >
            <strong>{{ p.name }}</strong>
            <small class="hint">
              {{ (p.songs || []).length }}
              {{ (p.songs || []).length === 1 ? "item" : "items" }}
            </small>
          </div>
        </div>
        <p v-else class="hint">No playlists yet.</p>
      </section>

      <section v-if="activeJobs.length" class="shelf">
        <h2>Downloading now</h2>
        <div v-for="j in activeJobs" :key="j.id" class="job">
          <span class="job-label">{{ j.type }} #{{ j.item_id }}</span>
          <div class="bar">
            <div class="fill" :style="{ width: (j.progress || 0) + '%' }" />
          </div>
          <span class="job-state">{{ j.status === "queued" ? "queued" : (j.progress || 0) + "%" }}</span>
        </div>
      </section>
    </template>

    <Transition name="modal">
      <AddMusicModal v-if="showAdd" @close="showAdd = false" @added="load" />
    </Transition>
  </div>
</template>

<style scoped>
.faces { display: flex; gap: 14px; align-items: flex-start; flex-wrap: wrap; margin: -8px 0 14px; }
.face-btn {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  background: none; border: 0; padding: 0; cursor: pointer; color: var(--muted);
  font-size: 11px; width: 48px;
}
.face-btn > span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.face-btn.active { color: var(--text); }
.face-btn.active :deep(.face) { box-shadow: 0 0 0 2px var(--bg), 0 0 0 3px var(--accent); }
.plus {
  width: 30px; height: 30px; border-radius: 50%; display: inline-flex;
  align-items: center; justify-content: center; font-size: 16px;
  border: 1px dashed var(--border); color: var(--muted); background: none;
}
.add-music { margin-left: auto; align-self: center; flex: none; }
.row-item { cursor: pointer; }
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
.pl-card { cursor: pointer; transition: border-color 0.15s ease; }
.pl-card:hover { border-color: #4b3f5a; }
.row { display: flex; gap: 10px; margin-bottom: 18px; }
.row input {
  flex: 0 1 280px; background: var(--inset); border: 1px solid var(--border);
  border-radius: 8px; color: var(--text); padding: 8px 12px; font-size: 14px; outline: none;
}
.row input:focus { border-color: var(--accent); }
.shelf { margin-bottom: 18px; }
.rows { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
.row-item {
  display: flex; align-items: center; gap: 14px; padding: 10px 14px;
  font-size: 14px; border-bottom: 1px solid var(--border);
}
.row-item:last-child { border-bottom: 0; }
.row-item .title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-item .artist { color: var(--muted); font-size: 13px; width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dot-state { width: 8px; height: 8px; border-radius: 50%; background: var(--border); flex: none; }
.dot-state.on { background: #56d364; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 12px; }
.pl-card {
  background: var(--panel); border: 1px solid var(--border); border-radius: 12px;
  padding: 14px; display: flex; flex-direction: column; gap: 4px;
}
.pl-card strong { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.job { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 3px 0; }
.job-label { width: 84px; color: var(--muted); flex: none; }
.bar { flex: 1; height: 6px; border-radius: 3px; background: var(--border); overflow: hidden; }
.fill { height: 100%; background-image: var(--grad); transition: width 0.4s; }
.job-state { width: 60px; flex: none; color: var(--muted); }
.empty { text-align: center; padding: 60px 0; }
.empty h3 { margin: 0 0 6px; font-size: 16px; }
code { background: var(--inset); border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; }
</style>
