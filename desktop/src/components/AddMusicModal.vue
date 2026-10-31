<script setup>
import { computed, onMounted, ref } from "vue";
import { api, currentUser, healthy } from "../store";

const emit = defineEmits(["close", "added"]);

const url = ref("");
const playlistId = ref(0);
const busy = ref(false);
const error = ref("");
const done = ref("");
const playlists = ref([]);

const ready = computed(() => healthy() && !!currentUser());

async function loadPlaylists() {
  const u = currentUser();
  if (!healthy() || !u) return;
  try {
    playlists.value = (await api(`/api/playlists?user_id=${u.id}`)).filter(
      (p) => p.kind !== "video"
    );
  } catch {
    /* list stays empty; "Add to library" still works */
  }
}

async function add() {
  const link = url.value.trim();
  if (!link || busy.value) return;
  busy.value = true;
  error.value = "";
  done.value = "";
  try {
    const body = { url: link, user_id: currentUser()?.id };
    if (playlistId.value) body.playlist_id = playlistId.value;
    const res = await api("/api/music/add", { method: "POST", body: JSON.stringify(body) });
    if (res.is_playlist) {
      done.value = `Added ${res.count} songs${
        playlistId.value ? "" : ' as a new playlist'
      }. Downloads are running in the background.`;
    } else {
      done.value = `Added "${res.title || "your song"}". It will be ready to play once downloaded.`;
    }
    url.value = "";
    emit("added");
  } catch (e) {
    error.value = `Could not add that link (${e.message}). Is it a music video or playlist URL?`;
  }
  busy.value = false;
}

onMounted(() => {
  document.getElementById("add-url")?.focus();
  loadPlaylists();
});
</script>

<template>
  <div class="scrim" @click.self="emit('close')">
    <div class="modal">
      <h2>Add music</h2>
      <p class="hint">
        Paste a YouTube video or playlist link. HomeTube figures out the rest —
        the download starts right away, even while other things play.
      </p>
      <input
        id="add-url"
        v-model="url"
        placeholder="https://youtube.com/…"
        :disabled="busy"
        @keydown.enter="add"
      />
      <select v-model.number="playlistId" :disabled="busy">
        <option :value="0">Add to library</option>
        <option v-for="p in playlists" :key="p.id" :value="p.id">
          Into “{{ p.name }}”
        </option>
      </select>
      <p v-if="busy" class="hint status">Fetching info from YouTube…</p>
      <p v-else-if="done" class="ok">{{ done }}</p>
      <p v-else-if="error" class="error">{{ error }}</p>
      <div class="actions">
        <button :disabled="!url.trim() || busy || !ready" @click="add">
          {{ busy ? "Adding…" : "Add" }}
        </button>
        <button class="secondary" @click="emit('close')">
          {{ done ? "Done" : "Cancel" }}
        </button>
      </div>
      <p v-if="!ready" class="hint">Waiting for the server…</p>
    </div>
  </div>
</template>

<style scoped>
.scrim {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.55);
  display: flex; align-items: center; justify-content: center; z-index: 40;
}
.modal {
  width: min(440px, 92vw); background: var(--panel);
  border: 1px solid var(--border); border-radius: 14px; padding: 24px;
}
h2 { margin: 0 0 6px; font-size: 17px; color: var(--text); text-transform: none; letter-spacing: 0; }
.hint { line-height: 1.55; }
input, select {
  width: 100%; margin-top: 12px; background: var(--inset);
  border: 1px solid var(--border); border-radius: 8px; color: var(--text);
  padding: 9px 12px; font-size: 14px; outline: none;
}
input:focus, select:focus { border-color: var(--accent); }
.status { margin: 12px 0 0; }
.ok { color: #56d364; font-size: 13px; margin: 12px 0 0; }
.actions { display: flex; gap: 10px; margin-top: 16px; }
</style>
