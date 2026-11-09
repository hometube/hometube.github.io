<script setup>
// Podcast add modal, mirroring the mobile add screen's two actions:
// subscribe to a channel as a podcast feed (server backfills recent episodes
// and the scheduler keeps checking), or add a single episode link to the
// podcast library. Criteria/interval semantics match the server:
// min/max length in seconds, check_interval in seconds (the form speaks
// minutes).
import { computed, onMounted, ref } from "vue";
import { api, currentUser, healthy } from "../store";

const props = defineProps({ initialTab: { type: String, default: "subscribe" } });
const emit = defineEmits(["close", "added"]);

const tab = ref(props.initialTab);
const url = ref("");
const keywords = ref("");
const minLength = ref("");
const maxLength = ref("");
const intervalMin = ref("60");
const busy = ref(false);
const error = ref("");
const done = ref("");

const ready = computed(() => healthy() && !!currentUser());

function num(v) {
  const n = Number(String(v).trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function subscribe() {
  const body = { url: url.value.trim(), user_id: currentUser()?.id };
  const kws = keywords.value.split(",").map((k) => k.trim()).filter(Boolean);
  const min = num(minLength.value);
  const max = num(maxLength.value);
  const criteria = {};
  if (kws.length) criteria.keywords = kws;
  if (min) criteria.min_length = Math.round(min * 60);
  if (max) criteria.max_length = Math.round(max * 60);
  if (Object.keys(criteria).length) body.criteria = criteria;
  const mins = num(intervalMin.value);
  if (mins) body.check_interval = Math.round(mins * 60);
  const res = await api("/api/podcasts/subscribe", { method: "POST", body: JSON.stringify(body) });
  done.value = res.backfilled
    ? `Subscribed — ${res.backfilled} recent episodes added, downloads running in the background.`
    : "Subscribed. New episodes will be checked for automatically.";
}

async function addEpisode() {
  const res = await api("/api/music/add", {
    method: "POST",
    body: JSON.stringify({ url: url.value.trim(), user_id: currentUser()?.id, kind: "podcast" }),
  });
  done.value = `Added "${res.title || "the episode"}". It will be ready to play once downloaded.`;
}

async function submit() {
  const link = url.value.trim();
  if (!link || busy.value) return;
  busy.value = true;
  error.value = "";
  done.value = "";
  try {
    if (tab.value === "subscribe") await subscribe();
    else await addEpisode();
    url.value = "";
    keywords.value = "";
    minLength.value = "";
    maxLength.value = "";
    emit("added");
  } catch (e) {
    error.value =
      tab.value === "subscribe"
        ? `Could not subscribe (${e.message}). Is it a channel URL with episodes?`
        : `Could not add that link (${e.message}). Is it a playable video or audio URL?`;
  }
  busy.value = false;
}

onMounted(() => {
  document.getElementById("sub-url")?.focus();
});
</script>

<template>
  <div class="scrim" @click.self="emit('close')">
    <div class="modal">
      <h2>{{ tab === "subscribe" ? "Subscribe to a podcast" : "Add podcast episode" }}</h2>
      <div class="tabs">
        <button :class="{ on: tab === 'subscribe' }" :disabled="busy" @click="tab = 'subscribe'">
          Subscribe
        </button>
        <button :class="{ on: tab === 'episode' }" :disabled="busy" @click="tab = 'episode'">
          Episode
        </button>
      </div>
      <p class="hint">
        <template v-if="tab === 'subscribe'">
          Paste a channel URL (usually YouTube). HomeTube adds the recent
          episodes and keeps checking for new ones.
        </template>
        <template v-else>
          A single video, podcast, or audio link — it lands under
          <em>Standalone episodes</em>.
        </template>
      </p>
      <input
        id="sub-url"
        v-model="url"
        placeholder="https://youtube.com/…"
        :disabled="busy"
        @keydown.enter="submit"
      />
      <template v-if="tab === 'subscribe'">
        <input
          v-model="keywords"
          placeholder="Keywords, comma separated (optional)"
          :disabled="busy"
          @keydown.enter="submit"
        />
        <div class="pair">
          <input v-model="minLength" placeholder="Min length (min)" :disabled="busy" />
          <input v-model="maxLength" placeholder="Max length (min)" :disabled="busy" />
          <input v-model="intervalMin" placeholder="Check every (min)" :disabled="busy" />
        </div>
      </template>
      <p v-if="busy" class="hint status">
        {{ tab === "subscribe" ? "Reading the channel…" : "Fetching info…" }}
      </p>
      <p v-else-if="done" class="ok">{{ done }}</p>
      <p v-else-if="error" class="error">{{ error }}</p>
      <div class="actions">
        <button :disabled="!url.trim() || busy || !ready" @click="submit">
          {{ busy ? "Working…" : tab === "subscribe" ? "Subscribe" : "Add episode" }}
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
h2 { margin: 0 0 10px; font-size: 17px; color: var(--text); text-transform: none; letter-spacing: 0; }
.tabs { display: flex; gap: 6px; margin-bottom: 4px; }
.tabs button {
  background: var(--inset); background-image: none; border: 1px solid var(--border);
  border-radius: 999px; padding: 5px 14px; font-size: 12.5px; font-weight: 500;
  color: var(--muted);
}
.tabs button.on { border-color: var(--accent); color: var(--text); }
.hint { line-height: 1.55; }
input {
  width: 100%; margin-top: 12px; background: var(--inset);
  border: 1px solid var(--border); border-radius: 8px; color: var(--text);
  padding: 9px 12px; font-size: 14px; outline: none;
}
input:focus { border-color: var(--accent); }
.pair { display: flex; gap: 8px; }
.status { margin: 12px 0 0; }
.ok { color: #56d364; font-size: 13px; margin: 12px 0 0; }
.actions { display: flex; gap: 10px; margin-top: 16px; }
</style>
