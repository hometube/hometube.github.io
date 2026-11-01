<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import QRCode from "qrcode";
import { api, healthy } from "../store";

const REPO = "hometube/hometube.github.io";
const pairInfo = ref(null);
const pairQr = ref("");
const pairError = ref("");
const mobile = ref(null);
const mobileChecked = ref(false);
const devices = ref([]);
let refreshTimer = null;
let deviceTimer = null;

// Which base the pairing URL (and QR) uses: LAN IP, mDNS hostname, or the
// user's own address. Mode and custom base persist across visits.
const hostMode = ref(
  ["ip", "hostname", "custom"].includes(localStorage.getItem("hometube.pairHostMode"))
    ? localStorage.getItem("hometube.pairHostMode")
    : "ip"
);
const customBase = ref(localStorage.getItem("hometube.pairCustomBase") || "");
const editing = ref(false); // custom input focused: show the bare base, no token
const draft = ref("");

const ready = computed(() => healthy());
const hostAvailable = computed(() => !!pairInfo.value?.host_url);

// Base URL for the selected mode; hostname falls back to the IP on servers
// that don't report one yet.
const baseUrl = computed(() => {
  if (hostMode.value === "custom") return customBase.value;
  if (!pairInfo.value) return "";
  if (hostMode.value === "hostname") return pairInfo.value.host_url || pairInfo.value.url;
  return pairInfo.value.url;
});

// The link with the current token re-attached. Never frozen while the user
// types: the token only joins on blur / display, and auto-refreshes when a
// re-mint lands.
const manualUrl = computed(() =>
  baseUrl.value && pairInfo.value?.token ? `${baseUrl.value}?token=${pairInfo.value.token}` : ""
);
const fieldUrl = computed(() => (editing.value ? draft.value : manualUrl.value));

function setMode(m) {
  if (m === "hostname" && !hostAvailable.value) return;
  hostMode.value = m;
  localStorage.setItem("hometube.pairHostMode", m);
}

function startEdit() {
  if (hostMode.value !== "custom") return;
  draft.value = customBase.value;
  editing.value = true;
}

function normBase(s) {
  let v = String(s || "").trim().replace(/[?#].*$/, "").replace(/\/+$/, "");
  if (!v) return "";
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) v = `http://${v}`;
  return v;
}

function endEdit() {
  editing.value = false;
  const v = normBase(draft.value);
  if (!v) return; // empty draft: keep the previous address
  customBase.value = v;
  localStorage.setItem("hometube.pairCustomBase", v);
}

async function loadDevices() {
  if (!ready.value) return;
  try {
    devices.value = await api("/api/devices");
  } catch {
    /* server may be restarting */
  }
}

function lastSeen(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

async function mint() {
  if (!ready.value) return;
  try {
    pairInfo.value = await api("/api/desktop/pair", { method: "POST" });
    pairError.value = "";
  } catch (e) {
    pairError.value = String(e);
  }
}

// QR mirrors the selected base: same deep-link payload the terminal QR uses.
// Rendered above the display size so it stays crisp on Retina screens.
let qrSeq = 0;
async function regenQr() {
  const seq = ++qrSeq;
  const base = baseUrl.value;
  const token = pairInfo.value?.token;
  if (!base || !token) {
    pairQr.value = "";
    return;
  }
  const url = await QRCode.toDataURL(
    `hometube://pair?url=${base}&token=${token}`,
    { margin: 1, width: 320, color: { dark: "#121016", light: "#ffffff" } }
  );
  if (seq === qrSeq) pairQr.value = url;
}
watch([baseUrl, () => pairInfo.value?.token], regenQr);

async function refreshMobile() {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=20`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    for (const r of await res.json()) {
      if (!String(r.tag_name).startsWith("mobile-v")) continue;
      const apk = (r.assets || []).find((a) => String(a.name).endsWith(".apk"));
      if (apk) {
        mobile.value = {
          version: String(r.tag_name).replace(/^mobile-v/, ""),
          apkUrl: apk.browser_download_url,
          size: apk.size || 0,
        };
        break;
      }
    }
  } catch {
    /* offline or none: the hint covers it */
  }
  mobileChecked.value = true;
}

function copyPair() {
  if (manualUrl.value) navigator.clipboard.writeText(manualUrl.value);
}

// Tokens live 5 minutes; re-mint just in time while the pane is open.
watch(ready, (ok) => {
  if (ok) {
    if (!pairInfo.value) mint();
    loadDevices();
  }
});

onMounted(() => {
  mint();
  loadDevices();
  refreshMobile();
  regenQr();
  refreshTimer = setInterval(() => {
    if (pairInfo.value) mint();
  }, 4 * 60 * 1000);
  deviceTimer = setInterval(loadDevices, 10000);
});
onUnmounted(() => {
  clearInterval(refreshTimer);
  clearInterval(deviceTimer);
});
</script>

<template>
  <div class="devices">
    <div class="page-head">
      <div class="page-head-title">
        <h2>Connect your phone</h2>
        <p class="hint lead">
          Open the HomeTube mobile app and scan this code, or paste the pairing
          address below.
        </p>
      </div>
      <div class="get-app">
        <template v-if="mobile">
          <span class="hint ver">
            Android v{{ mobile.version }} · {{ (mobile.size / 1048576).toFixed(1) }} MB
          </span>
          <a class="btnlink" :href="mobile.apkUrl">Download APK</a>
        </template>
        <span v-else class="hint ver">
          {{ mobileChecked ? "No Android release on GitHub yet." : "Checking GitHub Releases…" }}
        </span>
      </div>
    </div>


    <div class="pair-card">
      <img v-if="pairQr" :src="pairQr" class="pair-qr" alt="Pairing QR code" />
      <template v-else-if="!pairInfo">
        <p class="hint">
          {{ ready ? "Minting a pairing token…" : "Waiting for the server…" }}
        </p>
        <button :disabled="!ready" @click="mint">Create pairing token</button>
      </template>
      <div v-else class="qr-slot">
        <span class="hint">Enter your server address below to render the QR code.</span>
      </div>

      <div class="mode-row">
        <div class="seg">
          <button :class="{ on: hostMode === 'ip' }" @click="setMode('ip')">IP address</button>
          <button
            :class="{ on: hostMode === 'hostname' }"
            :disabled="!hostAvailable"
            :title="hostAvailable ? 'Bonjour name — survives DHCP lease changes' : 'Server does not report a hostname yet'"
            @click="setMode('hostname')"
          >
            Hostname
          </button>
          <button :class="{ on: hostMode === 'custom' }" @click="setMode('custom')">Custom</button>
        </div>
      </div>

      <div class="pair-url-row">
        <input
          class="pair-url"
          type="text"
          :value="fieldUrl"
          :disabled="hostMode !== 'custom'"
          :placeholder="'http://my-server:8000'"
          spellcheck="false"
          autocapitalize="off"
          autocorrect="off"
          @focus="startEdit"
          @blur="endEdit"
          @input="draft = $event.target.value"
        />
        <button class="icon-btn" title="Copy pairing link" :disabled="!manualUrl" @click="copyPair">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"
            ><path
              d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"
            /></svg>
        </button>
        <button class="icon-btn" title="New token" :disabled="!ready" @click="mint">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"
            ><path
              d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-8 8s3.57 8 8 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"
            /></svg>
        </button>
      </div>
      <p v-if="pairError" class="error">{{ pairError }}</p>
    </div>

    <p class="hint tips">
      This computer manages and hosts your library. Phones can connect to it to play and download your media.
    </p>

    <h2 class="roster-title">Connected devices</h2>
    <div v-if="devices.length" class="rows">
      <div v-for="d in devices" :key="d.id" class="dev-row">
        <span class="dot" :class="{ on: d.online }" :title="d.online ? 'Online now' : 'Seen recently'" />
        <span class="dev-name">{{ d.name }}</span>
        <span class="dev-user" v-if="d.username && d.username !== 'system'">{{ d.username }}</span>
        <span class="dev-seen">{{ d.online ? "Active now" : `Last seen ${lastSeen(d.last_seen)}` }}</span>
      </div>
    </div>
    <p v-else class="hint">
      No devices paired yet. Scan the code above with the mobile app and it
      will appear here. A green dot means it used the server in the last minute.
    </p>
  </div>
</template>

<style scoped>
/* Title row with the Android download parked on the right edge. */
.page-head {
  display: flex; align-items: baseline; justify-content: space-between;
  gap: 12px; flex-wrap: wrap; margin-bottom: 6px;
}
.page-head h2 { margin: 0; }
.get-app { display: flex; align-items: center; gap: 10px; }
.get-app .ver { white-space: nowrap; }
.lead { margin: 0 0 18px; }
/* Single centered pairing block: big QR, URL always visible. No card —
   it sits directly on the page background. */
.pair-card {
  max-width: 440px; margin: 0 auto; display: flex; flex-direction: column;
  align-items: center; text-align: center;
}
.pair-qr {
  display: block; width: 260px; height: 260px; border-radius: 10px;
  background: #fff; padding: 8px;
}
/* Placeholder while custom mode has no address yet: keeps the card height. */
.qr-slot {
  width: 260px; height: 260px; border-radius: 10px; box-sizing: border-box;
  border: 1px dashed var(--border); display: flex; align-items: center;
  justify-content: center; padding: 20px;
}
.mode-row { display: flex; justify-content: center; margin-top: 16px; }
.seg { display: inline-flex; border: 1px solid var(--border); border-radius: 9px; overflow: hidden; }
.seg button {
  background: none; color: var(--muted); border-radius: 0; padding: 7px 14px;
  font-size: 13px; font-weight: 500;
}
.seg button + button { border-left: 1px solid var(--border); }
.seg button:hover:not(:disabled) { background: none; filter: none; color: var(--text); }
.seg button.on { background: var(--inset); color: var(--text); font-weight: 600; }
.pair-url-row { display: flex; align-items: center; gap: 8px; margin-top: 10px; width: 100%; }
.pair-url {
  flex: 1; min-width: 0; margin: 0; text-align: left;
  font-family: ui-monospace, monospace; font-size: 11px;
  background: var(--inset); border: 1px solid var(--border);
  padding: 8px 10px; border-radius: 6px; color: var(--muted);
  text-overflow: ellipsis;
}
/* Disabled inputs gray out text via -webkit-text-fill-color; pin it so the
   link stays readable. Editing (custom mode) shows the bare base — the
   token is re-attached on blur. */
.pair-url:disabled { opacity: 1; -webkit-text-fill-color: var(--muted); }
.pair-url:focus {
  outline: none; border-color: var(--accent); color: var(--text);
  -webkit-text-fill-color: var(--text);
}
.pair-url::placeholder { color: var(--muted); opacity: 0.6; }
/* Ghost icon buttons (copy / refresh) beside the URL. */
.icon-btn {
  width: 32px; height: 32px; flex: none; background: none;
  border: 1px solid var(--border); border-radius: 50%; color: var(--muted);
  display: inline-flex; align-items: center; justify-content: center; padding: 0;
  transition: border-color 0.15s ease, color 0.15s ease;
}
.icon-btn:hover:not(:disabled) { background: none; filter: none; border-color: var(--accent); color: var(--accent); }
.tips { max-width: 440px; margin: 16px auto 0; line-height: 1.55; text-align: center; }
.roster-title { margin: 28px 0 12px; }
.rows {
  background: var(--panel); border: 1px solid var(--border);
  border-radius: 12px; overflow: hidden; max-width: 640px;
}
.dev-row {
  display: flex; align-items: center; gap: 12px; padding: 11px 14px;
  font-size: 14px; border-bottom: 1px solid var(--border);
}
.dev-row:last-child { border-bottom: 0; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--border); flex: none; }
.dot.on { background: #56d364; }
.dev-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dev-user {
  font-size: 11px; color: var(--accent); background: rgba(198, 120, 221, 0.12);
  padding: 2px 8px; border-radius: 999px; flex: none;
}
.dev-seen { color: var(--muted); font-size: 12px; flex: none; }
</style>
