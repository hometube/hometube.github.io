<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { api, currentUser, healthy } from "../store";

const playlists = ref([]);
let timer = null;

const user = computed(() => currentUser());

async function load() {
  if (!healthy() || !user.value) {
    playlists.value = [];
    return;
  }
  try {
    playlists.value = await api(`/api/playlists?user_id=${user.value.id}`);
  } catch {
    /* server may be restarting */
  }
}

watch(user, load);
onMounted(() => {
  load();
  timer = setInterval(load, 8000);
});
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <div>
    <h2>Playlists</h2>
    <div v-if="playlists.length" class="cards">
      <div v-for="p in playlists" :key="p.id" class="card">
        <strong>{{ p.name }}</strong>
        <small class="hint">
          {{ p.kind === "video" ? "Videos" : "Music" }} ·
          {{ (p.songs || []).length }}
          {{ (p.songs || []).length === 1 ? "item" : "items" }}
        </small>
      </div>
    </div>
    <p v-else class="hint">
      No playlists for {{ user?.username || "you" }} yet. Playlists created
      with <code>ht</code> or the mobile app show up here.
    </p>
  </div>
</template>

<style scoped>
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
.card { padding: 16px; display: flex; flex-direction: column; gap: 5px; }
.card strong { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
code { background: var(--inset); border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; }
</style>
