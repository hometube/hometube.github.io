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
let refreshTimer = null;

const ready = computed(() => healthy());

async function mint() {
  if (!ready.value) return;
  try {
    pairInfo.value = await api("/api/desktop/pair", { method: "POST" });
    // Same deep-link payload the terminal QR uses.
    pairQr.value = await QRCode.toDataURL(
      `hometube://pair?url=${pairInfo.value.url}&token=${pairInfo.value.token}`,
      { margin: 1, width: 220, color: { dark: "#121016", light: "#ffffff" } }
    );
    pairError.value = "";
  } catch (e) {
    pairError.value = String(e);
  }
}

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
  if (pairInfo.value)
    navigator.clipboard.writeText(`${pairInfo.value.url}?token=${pairInfo.value.token}`);
}

// Tokens live 5 minutes; re-mint just in time while the pane is open.
watch(ready, (ok) => {
  if (ok && !pairInfo.value) mint();
});

onMounted(() => {
  mint();
  refreshMobile();
  refreshTimer = setInterval(() => {
    if (pairInfo.value) mint();
  }, 4 * 60 * 1000);
});
onUnmounted(() => clearInterval(refreshTimer));
</script>

<template>
  <div class="devices">
    <h2>Connect your phone</h2>
    <p class="hint lead">
      Open the HomeTube mobile app and scan this code. The token works once and
      renews automatically while this page is open.
    </p>
    <div class="pair-grid">
      <div class="card pair-card">
        <template v-if="pairQr">
          <img :src="pairQr" class="pair-qr" alt="Pairing QR code" />
          <div class="pair-actions">
            <button class="secondary" @click="copyPair">Copy link</button>
            <button class="secondary" @click="mint">New token</button>
          </div>
          <details class="manual">
            <summary>Enter manually</summary>
            <p class="pair-url">{{ pairInfo.url }}?token={{ pairInfo.token }}</p>
          </details>
        </template>
        <template v-else>
          <p class="hint">
            {{ ready ? "Minting a pairing token…" : "Waiting for the server…" }}
          </p>
          <button :disabled="!ready" @click="mint">Create pairing token</button>
        </template>
        <p v-if="pairError" class="error">{{ pairError }}</p>
      </div>

      <div class="card">
        <h3>Get the mobile app</h3>
        <template v-if="mobile">
          <p class="hint">
            Android v{{ mobile.version }} ·
            {{ (mobile.size / 1048576).toFixed(1) }} MB
          </p>
          <a class="btnlink" :href="mobile.apkUrl">Download APK</a>
          <p class="hint tips">Install it on a phone, then scan the code.</p>
        </template>
        <p v-else class="hint">
          {{ mobileChecked
            ? "No Android release on GitHub yet."
            : "Checking GitHub Releases…" }}
        </p>
        <p class="hint tips">
          Your library lives on this computer, so phones join the same library —
          play, resume, and playlists stay in sync.
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pair-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; max-width: 640px; }
.lead { margin: 0 0 16px; }
.pair-card { display: flex; flex-direction: column; align-items: flex-start; }
.pair-qr {
  display: block; width: 200px; height: 200px; border-radius: 10px;
  margin-bottom: 12px; background: #fff; padding: 6px;
}
.pair-actions { display: flex; gap: 8px; }
.manual { margin-top: 12px; }
.manual summary { color: var(--muted); font-size: 13px; cursor: pointer; }
.pair-url {
  font-family: ui-monospace, monospace; font-size: 12px; word-break: break-all;
  background: var(--inset); border: 1px solid var(--border);
  padding: 8px; border-radius: 6px;
}
h3 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 0 0 10px; }
.tips { margin-top: 12px; line-height: 1.55; }
</style>
