<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  api,
  finishWizard,
  healthy,
  refreshUsers,
  setCurrentUser,
  state,
} from "../store";
import FaceAvatar from "../components/FaceAvatar.vue";

const emit = defineEmits(["done"]);

const step = ref(1);
const name = ref("");
const busy = ref(false);
const error = ref("");
const counts = ref(null); // { music, videos } when an existing library is found

const storage = computed(() => state.storage);
const configured = computed(() => !!storage.value?.configured);

async function useSuggested() {
  await applyDir(storage.value.suggested_dir);
}

async function chooseDir() {
  const picked = await open({
    directory: true,
    title: "Choose your HomeTube folder",
    defaultPath: storage.value?.suggested_dir,
  });
  if (picked) await applyDir(picked);
}

async function applyDir(dir) {
  error.value = "";
  busy.value = true;
  try {
    state.storage = await invoke("set_data_dir", { dir });
  } catch (e) {
    error.value = String(e);
  }
  busy.value = false;
}

// Once the folder is set and the server is back on it, size up an existing
// library so returning users see "welcome back" instead of an empty shell.
watch(
  () => configured.value && healthy(),
  (ready) => {
    if (ready && step.value === 2) loadCounts();
  },
  { immediate: true }
);

async function loadCounts() {
  try {
    const [music, videos] = await Promise.all([
      api("/api/music"),
      api("/api/videos?filter=all"),
    ]);
    counts.value = { music: music.length, videos: videos.length };
  } catch {
    counts.value = null;
  }
}

async function addFace() {
  const username = name.value.trim();
  if (!username || busy.value) return;
  error.value = "";
  busy.value = true;
  try {
    await api("/api/users", { method: "POST", body: JSON.stringify({ username }) });
    await refreshUsers();
    name.value = "";
  } catch (e) {
    error.value = String(e);
  }
  busy.value = false;
}

function finish() {
  if (state.users.length) setCurrentUser(state.users[0].id);
  finishWizard();
  emit("done");
}

onMounted(() => {
  if (configured.value && step.value === 1) step.value = 2;
});
</script>

<template>
  <div class="wizard">
    <div class="panel">
      <div class="dots">
        <span class="dot" :class="{ on: step >= 1 }" />
        <span class="dot" :class="{ on: step >= 2 }" />
        <span class="dot" :class="{ on: step >= 3 }" />
      </div>

      <!-- Step 1: welcome -->
      <template v-if="step === 1">
        <img class="logo" src="/icon.png" alt="" />
        <h2>Your media library, at home.</h2>
        <p class="sub">
          HomeTube keeps the videos, music and podcasts you love on your own
          hardware — downloadable, playable, and yours. Let's get you set up.
        </p>
        <button @click="step = configured ? 3 : 2">Get started</button>
      </template>

      <!-- Step 2: library folder -->
      <template v-else-if="step === 2">
        <h2>Where should your library live?</h2>
        <p class="sub">
          HomeTube stores its database and all downloads in a single folder.
          Already have one from another install? Pick the folder that contains
          its <code>db.sqlite</code>.
        </p>
        <template v-if="!configured">
          <button :disabled="busy" @click="useSuggested">
            Use {{ storage?.suggested_dir }}
          </button>
          <div>
            <button class="secondary" :disabled="busy" @click="chooseDir">
              I already have a HomeTube folder…
            </button>
          </div>
        </template>
        <template v-else>
          <p class="ok-box">{{ storage.data_dir }}</p>
          <p v-if="counts" class="found">
            <template v-if="counts.music || counts.videos"
              >Found your library — {{ counts.music }}
              {{ counts.music === 1 ? "song" : "songs"
              }}<template v-if="counts.videos"
                >, {{ counts.videos }}
                {{ counts.videos === 1 ? "video" : "videos" }}</template
              >. Welcome back.</template
            >
            <template v-else>Your library folder is ready.</template>
          </p>
          <p v-else-if="!healthy()" class="found">Restarting HomeTube…</p>
          <p v-else-if="storage.db_exists" class="found">
            Found your library here. Welcome back.
          </p>
          <div class="row">
            <button :disabled="!healthy()" @click="step = 3">Continue</button>
            <button class="secondary" :disabled="busy" @click="chooseDir">
              Change…
            </button>
          </div>
        </template>
        <p v-if="state.status?.adopted" class="note">
          HomeTube is running a server started elsewhere; it keeps its current
          folder until it restarts.
        </p>
        <p v-if="error" class="error">{{ error }}</p>
      </template>

      <!-- Step 3: faces -->
      <template v-else>
        <h2>Who's in your household?</h2>
        <p class="sub">
          Each face gets their own library and playlists. You can add more
          anytime.
        </p>
        <div v-if="state.users.length" class="faces">
          <span v-for="u in state.users" :key="u.id" class="face-item">
            <FaceAvatar :name="u.username" :size="44" />
            <small>{{ u.username }}</small>
          </span>
        </div>
        <form class="row" @submit.prevent="addFace">
          <input
            v-model="name"
            placeholder="Name"
            maxlength="40"
            :disabled="busy || !healthy()"
          />
          <button type="submit" :disabled="!name.trim() || busy || !healthy()">
            Add
          </button>
        </form>
        <div class="row spread">
          <button :disabled="!state.users.length" @click="finish">
            Start listening
          </button>
          <button class="secondary" @click="finish">Skip for now</button>
        </div>
        <p v-if="error" class="error">{{ error }}</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.wizard {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.panel {
  width: 100%;
  max-width: 440px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 36px;
  text-align: center;
}
.dots { display: flex; gap: 8px; justify-content: center; margin-bottom: 28px; }
.dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--border);
}
.dot.on { background-image: var(--grad); }
.logo { width: 88px; height: 88px; border-radius: 22px; margin-bottom: 18px; }
h2 { font-size: 21px; margin: 0 0 10px; letter-spacing: -0.01em; color: var(--text); text-transform: none; }
.sub { color: var(--muted); font-size: 14px; line-height: 1.6; margin: 0 0 22px; }
.sub code { background: var(--inset); border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; }
.ok-box {
  font-family: ui-monospace, monospace; font-size: 12px; word-break: break-all;
  background: var(--inset); border: 1px solid var(--border);
  padding: 10px; border-radius: 8px; margin: 0 0 12px; color: var(--text);
}
.found { color: var(--accent); font-size: 14px; margin: 0 0 18px; }
.note { color: var(--muted); font-size: 12px; margin: 14px 0 0; }
.row { display: flex; gap: 10px; justify-content: center; align-items: center; margin-top: 12px; }
.spread { justify-content: space-between; }
.row button { margin: 0; }
input {
  flex: 1; background: var(--inset); border: 1px solid var(--border);
  border-radius: 8px; color: var(--text); padding: 9px 12px; font-size: 14px;
  text-align: left; outline: none;
}
input:focus { border-color: var(--accent); }
.faces { display: flex; flex-wrap: wrap; gap: 16px; justify-content: center; margin-bottom: 20px; }
.face-item { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.face-item small { color: var(--muted); max-width: 72px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
button + button { margin-top: 10px; }
.row button + button, .faces + .row button { margin-top: 0; }
</style>
