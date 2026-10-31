<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { api, currentUser, healthy, refreshUsers, setCurrentUser, state } from "../store";
import FaceAvatar from "../components/FaceAvatar.vue";

const music = ref([]);
const playlists = ref([]);
const jobs = ref([]);
const adding = ref(false);
const name = ref("");
const error = ref("");
let timer = null;

const user = computed(() => currentUser());
const activeJobs = computed(() =>
  jobs.value.filter((j) => j.status === "queued" || j.status === "running")
);

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
        <FaceAvatar :name="u.username" :size="46" />
        <span>{{ u.username }}</span>
      </button>
      <button class="face-btn add" title="Add a face" @click="adding = !adding">
        <span class="plus">+</span>
      </button>
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
        <div v-if="music.length" class="rows">
          <div v-for="m in music.slice(0, 8)" :key="m.id" class="row-item">
            <span class="title" :title="m.title">{{ m.title || "Untitled" }}</span>
            <span class="artist">{{ m.artist || "—" }}</span>
            <span class="dot-state" :class="{ on: m.filename }" :title="m.filename ? 'On disk' : 'Not downloaded'" />
          </div>
        </div>
        <p v-else class="hint">
          Nothing yet for {{ user?.username }}. Add music with
          <code>ht download &lt;url&gt;</code> or the mobile app — playback
          here arrives in the next release.
        </p>
      </section>

      <section class="shelf">
        <h2>Your playlists</h2>
        <div v-if="playlists.length" class="cards">
          <div v-for="p in playlists" :key="p.id" class="pl-card">
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
  </div>
</template>

<style scoped>
.faces { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; margin-bottom: 22px; }
.face-btn {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  background: none; border: 0; padding: 4px 6px; cursor: pointer; color: var(--muted);
  border-radius: 10px; font-size: 12px; max-width: 84px;
}
.face-btn span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.face-btn.active { color: var(--text); }
.face-btn.active :deep(.face) { box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--accent); }
.plus {
  width: 46px; height: 46px; border-radius: 50%; display: inline-flex;
  align-items: center; justify-content: center; font-size: 22px;
  border: 1px dashed var(--border); color: var(--muted); background: none;
}
.row { display: flex; gap: 10px; margin-bottom: 18px; }
.row input {
  flex: 0 1 280px; background: var(--inset); border: 1px solid var(--border);
  border-radius: 8px; color: var(--text); padding: 8px 12px; font-size: 14px; outline: none;
}
.row input:focus { border-color: var(--accent); }
.shelf { margin-bottom: 26px; }
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
