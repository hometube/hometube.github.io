<script setup>
import { computed, onMounted, onUnmounted, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";

const status = ref(null);
const logs = ref([]);
const pairInfo = ref(null);
const users = ref(null);
const apiError = ref("");
let timers = [];

const apiBase = computed(() =>
  status.value ? `http://127.0.0.1:${status.value.port}` : null
);

const healthy = computed(() => status.value?.healthy);

async function refreshStatus() {
  status.value = await invoke("server_status");
}

async function refreshLogs() {
  logs.value = await invoke("server_logs", { tail: 200 });
  const el = document.getElementById("logs");
  if (el) el.scrollTop = el.scrollHeight;
}

async function refreshApi() {
  if (!apiBase.value || !healthy.value) return;
  try {
    const res = await fetch(`${apiBase.value}/api/users`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    users.value = await res.json();
    apiError.value = "";
  } catch (e) {
    users.value = null;
    apiError.value = String(e);
  }
}

async function pairDevice() {
  if (!apiBase.value) return;
  const res = await fetch(`${apiBase.value}/api/desktop/pair`, {
    method: "POST",
  });
  pairInfo.value = await res.json();
}

async function stopServer() {
  await invoke("server_stop");
  await refreshStatus();
}

async function startServer() {
  await invoke("server_start");
  await refreshStatus();
}

function copyPair() {
  if (pairInfo.value)
    navigator.clipboard.writeText(`${pairInfo.value.url}?token=${pairInfo.value.token}`);
}

onMounted(() => {
  refreshStatus();
  timers.push(setInterval(refreshStatus, 2000));
  timers.push(setInterval(refreshLogs, 2000));
  timers.push(setInterval(refreshApi, 3000));
});

onUnmounted(() => timers.forEach(clearInterval));
</script>

<template>
  <main class="page">
    <header>
      <h1>HomeTube</h1>
      <span v-if="status" class="badge" :class="healthy ? 'ok' : 'bad'">
        {{ healthy ? "● Server running" : status.running ? "● Starting…" : "● Server stopped" }}
      </span>
      <span v-else class="badge">…</span>
    </header>

    <section class="grid">
      <div class="card">
        <h2>Server</h2>
        <dl v-if="status">
          <dt>Port</dt>
          <dd>{{ status.port }}</dd>
          <dt>Backend</dt>
          <dd>{{ status.backend_found ? "found" : "not found" }}</dd>
          <dt>Health</dt>
          <dd>{{ healthy ? "OK" : "unreachable" }}</dd>
        </dl>
        <div class="actions">
          <button v-if="!status?.running" @click="startServer">Start</button>
          <button v-else @click="stopServer">Stop</button>
        </div>
      </div>

      <div class="card">
        <h2>Connect a device</h2>
        <template v-if="pairInfo">
          <p class="pair-url">{{ pairInfo.url }}?token={{ pairInfo.token }}</p>
          <p class="hint">
            Single use, expires in {{ pairInfo.expires_in }}s. Enter it in the
            mobile app's backend URL screen.
          </p>
          <button @click="copyPair">Copy</button>
        </template>
        <template v-else>
          <p class="hint">Mint a one-time pairing token for the mobile app.</p>
          <button :disabled="!healthy" @click="pairDevice">Create pairing token</button>
        </template>
      </div>

      <div class="card">
        <h2>Library</h2>
        <template v-if="users">
          <dl>
            <dt>Users</dt>
            <dd>{{ users.length }}</dd>
          </dl>
          <p class="hint">{{ users.map((u) => u.username).join(", ") || "no users yet" }}</p>
        </template>
        <p v-else class="hint">{{ apiError || "waiting for the server…" }}</p>
      </div>
    </section>

    <section class="card logs-card">
      <h2>Server logs</h2>
      <pre id="logs">{{ logs.join("\n") }}</pre>
    </section>
  </main>
</template>

<style>
:root {
  color-scheme: dark;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
* { box-sizing: border-box; }
body { margin: 0; background: #0f1115; color: #e6e6e6; }
.page { padding: 24px; max-width: 1100px; margin: 0 auto; }
header { display: flex; align-items: center; gap: 16px; margin-bottom: 20px; }
h1 { font-size: 22px; margin: 0; }
h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.06em; color: #9aa0aa; margin: 0 0 12px; }
.badge { font-size: 13px; color: #9aa0aa; }
.badge.ok { color: #4ade80; }
.badge.bad { color: #f87171; }
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 16px; }
.card { background: #171a21; border: 1px solid #262b36; border-radius: 10px; padding: 16px; }
dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 16px; margin: 0 0 12px; font-size: 14px; }
dt { color: #9aa0aa; }
dd { margin: 0; }
button {
  background: #2563eb; color: #fff; border: 0; border-radius: 6px;
  padding: 8px 14px; font-size: 14px; cursor: pointer;
}
button:disabled { opacity: 0.4; cursor: default; }
button:hover:not(:disabled) { background: #1d4ed8; }
.hint { font-size: 13px; color: #9aa0aa; }
.pair-url {
  font-family: ui-monospace, monospace; font-size: 12px; word-break: break-all;
  background: #0f1115; padding: 8px; border-radius: 6px;
}
.logs-card pre {
  background: #0f1115; border-radius: 6px; padding: 12px; font-size: 12px;
  height: 280px; overflow-y: auto; white-space: pre-wrap; margin: 0;
}
</style>
