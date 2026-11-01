<script setup>
import { computed, onMounted, onUnmounted, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getVersion } from "@tauri-apps/api/app";
import { api, apiBase, healthy, refreshStatus, state } from "../store";
import { checkForUpdate, updateAvailable, updater } from "../updates";

const logs = ref([]);
const logPath = ref("");
const jobs = ref([]);
const subs = ref([]);
const autoStart = ref(false);
const autoDownload = ref(true);
const storageError = ref("");
const version = ref("");
const ytdlpUpdating = ref(false);
const ytdlpMsg = ref("");

// Account cookies for Premium/age-gated downloads. Browser source follows
// the browser's login automatically; a cookies.txt file takes precedence.
const COOKIE_BROWSERS = ["safari", "chrome", "edge", "brave", "firefox", "chromium", "vivaldi", "opera"];
const cookiesBrowser = ref("");
const cookiesFile = ref("");
const cookiesTest = ref(null);
const cookiesTesting = ref(false);

async function loadCookies() {
  if (!healthy()) return;
  try {
    const s = await api("/api/settings");
    cookiesBrowser.value = s.cookies_browser || "";
    cookiesFile.value = s.cookies_file || "";
  } catch {
    /* keep defaults */
  }
}

async function setCookies(key, value) {
  if (key === "cookies_browser") cookiesBrowser.value = value;
  else cookiesFile.value = value;
  cookiesTest.value = null;
  try {
    await api("/api/settings", { method: "PUT", body: JSON.stringify({ key, value }) });
  } catch (e) {
    cookiesTest.value = { ok: false, detail: String(e) };
  }
}

async function chooseCookiesFile() {
  const picked = await open({
    title: "Netscape cookies.txt export",
    filters: [{ name: "cookies.txt", extensions: ["txt"] }],
  });
  if (picked) setCookies("cookies_file", String(picked));
}

async function testCookies() {
  cookiesTesting.value = true;
  try {
    cookiesTest.value = await api("/api/settings/cookies/test", { method: "POST" });
  } catch (e) {
    cookiesTest.value = { ok: false, detail: String(e) };
  } finally {
    cookiesTesting.value = false;
  }
}

// yt-dlp fix the YouTube breakage upstream in days; update without a new app
// build. "Nightly" opts into fixes still baking on the nightly channel.
async function updateYtdlp(channel = "stable") {
  ytdlpUpdating.value = true;
  ytdlpMsg.value = "";
  try {
    const res = await api("/api/settings/ytdlp/update", {
      method: "POST",
      body: JSON.stringify({ channel }),
    });
    ytdlpMsg.value = res.ok
      ? `Now on ${res.version || "?"}.`
      : res.error || "Update failed.";
  } catch (e) {
    ytdlpMsg.value = String(e);
  } finally {
    ytdlpUpdating.value = false;
    refreshStatus();
  }
}

const status = computed(() => state.status);
const storage = computed(() => state.storage);

async function refreshLogs() {
  logs.value = await invoke("server_logs", { tail: 200 });
  if (!logPath.value) logPath.value = await invoke("server_log_path");
  const el = document.getElementById("logs");
  if (el) el.scrollTop = el.scrollHeight;
}

async function refreshJobs() {
  if (!healthy()) {
    jobs.value = [];
    return;
  }
  try {
    const res = await fetch(`${apiBase()}/api/downloads`);
    jobs.value = res.ok ? await res.json() : [];
  } catch {
    jobs.value = [];
  }
}

async function refreshSubs() {
  if (!healthy()) {
    subs.value = [];
    return;
  }
  try {
    const res = await fetch(`${apiBase()}/api/subscriptions`);
    subs.value = res.ok ? await res.json() : [];
  } catch {
    subs.value = [];
  }
}

async function stopServer() {
  await invoke("server_stop");
  await refreshStatus();
}

async function startServer() {
  await invoke("server_start");
  await refreshStatus();
}

async function chooseDir() {
  const picked = await open({
    directory: true,
    title: "Choose HomeTube data folder",
    defaultPath: storage.value?.data_dir || storage.value?.suggested_dir,
  });
  if (!picked) return;
  storageError.value = "";
  try {
    state.storage = await invoke("set_data_dir", { dir: picked });
    await refreshStatus();
  } catch (e) {
    storageError.value = String(e);
  }
}

async function toggleAutoStart(v) {
  await invoke("autostart_set", { enabled: v });
  autoStart.value = await invoke("autostart_get");
}

async function toggleAutoDownload(v) {
  await api("/api/settings", {
    method: "PUT",
    body: JSON.stringify({ key: "auto_download", value: v ? "on" : "off" }),
  });
  autoDownload.value = v;
}

async function loadAutoDownload() {
  if (!healthy()) return;
  try {
    const s = await api("/api/settings");
    autoDownload.value = s.auto_download !== "off";
  } catch {
    /* keep default */
  }
}

function copyLogPath() {
  navigator.clipboard.writeText(logPath.value);
}

let timers = [];
onMounted(async () => {
  refreshLogs();
  refreshJobs();
  refreshSubs();
  loadAutoDownload();
  loadCookies();
  version.value = await getVersion().catch(() => "");
  autoStart.value = await invoke("autostart_get").catch(() => false);
  timers.push(setInterval(refreshLogs, 2000));
  timers.push(setInterval(refreshJobs, 2500));
  timers.push(setInterval(refreshSubs, 15000));
});
onUnmounted(() => timers.forEach(clearInterval));
</script>

<template>
  <div class="settings">
    <h2>Settings</h2>

    <details class="sec" open>
      <summary>Preferences</summary>
      <label class="toggle">
        <input type="checkbox" :checked="autoStart" @change="toggleAutoStart($event.target.checked)" />
        <span>Open HomeTube at login</span>
      </label>
      <p class="hint sub-text">The media server keeps running for your devices as long as this app is open.</p>
      <label class="toggle">
        <input
          type="checkbox"
          :checked="autoDownload"
          :disabled="!healthy()"
          @change="toggleAutoDownload($event.target.checked)"
        />
        <span>Download new items automatically</span>
      </label>
      <p class="hint sub-text">When off, media downloads the first time you play it.</p>
    </details>

    <details class="sec">
      <summary>Server</summary>
      <dl v-if="status">
        <dt>Port</dt>
        <dd>{{ status.port }}</dd>
        <dt>Source</dt>
        <dd>{{ status.adopted ? "external process" : status.running ? "started by HomeTube" : "stopped" }}</dd>
        <dt>Health</dt>
        <dd>{{ healthy() ? "OK" : "unreachable" }}</dd>
        <template v-if="status.tools">
          <dt>Tools</dt>
          <dd>
            {{ status.tools.ffmpeg ? "ffmpeg ✓" : "ffmpeg missing" }} ·
            {{ status.tools.js_runtime ? status.tools.js_runtime + " ✓" : "no JS runtime" }}
          </dd>
          <dt>yt-dlp</dt>
          <dd>
            <template v-if="status.tools.yt_dlp_version">
              {{ status.tools.yt_dlp_version }}
              <button class="link-btn" :disabled="ytdlpUpdating" @click="updateYtdlp('stable')">
                {{ ytdlpUpdating ? "Updating…" : "Update" }}
              </button>
              <button class="link-btn" :disabled="ytdlpUpdating" @click="updateYtdlp('nightly')">
                Nightly
              </button>
            </template>
            <template v-else>missing — install with <code>brew install yt-dlp</code></template>
            <span v-if="ytdlpMsg" class="hint"> {{ ytdlpMsg }}</span>
          </dd>
        </template>
      </dl>
      <p v-if="status?.tools && (!status.tools.ffmpeg || !status.tools.js_runtime)" class="hint">
        Downloads may fail until the missing tools are installed (ffmpeg for
        audio conversion, a JS runtime like deno for YouTube).
      </p>
      <div class="actions">
        <button v-if="!status?.running" @click="startServer">Start</button>
        <button v-else-if="status.adopted" disabled>Stop</button>
        <button v-else class="secondary" @click="stopServer">Stop</button>
      </div>

      <div class="cookies">
        <h3 class="sec-sub">Cookies</h3>
        <p class="hint">
          Premium and age-gated tracks download with YouTube account cookies;
          the browser you pick must already be signed in to YouTube.
        </p>
        <dl>
          <dt>Browser</dt>
          <dd>
            <select
              :value="cookiesBrowser"
              :disabled="!healthy()"
              @change="setCookies('cookies_browser', $event.target.value)"
            >
              <option value="">None</option>
              <option v-for="b in COOKIE_BROWSERS" :key="b" :value="b">{{ b }}</option>
            </select>
          </dd>
          <dt>cookies.txt</dt>
          <dd>
            <span class="path small">{{ cookiesFile || "not set" }}</span>
            <button class="link-btn" :disabled="!healthy()" @click="chooseCookiesFile">
              {{ cookiesFile ? "Change…" : "Choose…" }}
            </button>
            <button v-if="cookiesFile" class="link-btn" :disabled="!healthy()" @click="setCookies('cookies_file', '')">
              Clear
            </button>
          </dd>
        </dl>
        <p class="hint">
          A cookies.txt file wins over the browser. On macOS, Safari and Chrome need
          Full Disk Access for HomeTube (<em>System Settings &rarr; Privacy &amp; Security</em>)
          and a Keychain prompt appears on first read — click <em>Always Allow</em>;
          Firefox needs neither. A <code>cookies.txt</code> in the library folder is
          picked up automatically.
        </p>
        <div class="actions">
          <button class="secondary" :disabled="!healthy() || cookiesTesting" @click="testCookies">
            {{ cookiesTesting ? "Testing…" : "Test cookies" }}
          </button>
          <span v-if="cookiesTest" class="test-state" :class="cookiesTest.ok ? 'ok' : 'bad'">
            {{ cookiesTest.detail }}
          </span>
        </div>
      </div>
    </details>

    <details class="sec">
      <summary>Downloads</summary>
      <template v-if="jobs.length">
        <div v-for="j in jobs.slice(0, 12)" :key="j.id" class="job">
          <span class="job-label">{{ j.type }} #{{ j.item_id }}</span>
          <div class="bar">
            <div class="fill" :class="j.status" :style="{ width: (j.status === 'done' ? 100 : j.progress || 0) + '%' }" />
          </div>
          <span class="job-state" :class="j.status">
            {{
              j.status === "error"
                ? String(j.error || "error").slice(0, 48)
                : j.status === "running"
                  ? (j.progress || 0) + "%"
                  : j.status
            }}
          </span>
        </div>
        <p v-if="jobs.length > 12" class="hint">+{{ jobs.length - 12 }} more</p>
      </template>
      <p v-else class="hint">No download activity.</p>
    </details>

    <details class="sec">
      <summary>Storage</summary>
      <template v-if="storage">
        <p class="path">{{ storage.data_dir || "backend default (./data)" }}</p>
        <p class="hint">
          <template v-if="storage.db_exists">Existing library detected here.</template>
          <template v-else-if="storage.configured">No database in this folder yet — created on first use.</template>
          <template v-else>Using the backend's built-in default; set a folder to manage it here.</template>
        </p>
        <button class="secondary" @click="chooseDir">Change folder…</button>
        <p v-if="storageError" class="error">{{ storageError }}</p>
      </template>
    </details>

    <details class="sec">
      <summary>Subscriptions</summary>
      <template v-if="subs.length">
        <div v-for="s in subs" :key="s.kind + s.subscription_id" class="sub">
          <span class="sub-kind" :class="s.kind">{{ s.kind }}</span>
          <span class="sub-name" :title="s.channel_url">{{ s.channel_name }}</span>
          <span class="sub-count">{{ s.downloaded_count }}/{{ s.item_count }}</span>
        </div>
      </template>
      <p v-else class="hint">No subscriptions yet.</p>
    </details>

    <details class="sec">
      <summary>Logs</summary>
      <pre id="logs">{{ logs.join("\n") }}</pre>
      <div v-if="logPath" class="log-path">
        <span class="hint path">{{ logPath }}</span>
        <button class="secondary" @click="copyLogPath">Copy path</button>
      </div>
    </details>

    <details class="sec">
      <summary>About</summary>
      <dl>
        <dt>Version</dt>
        <dd>
          {{ version || "—" }}
          <span v-if="updater.latest" class="hint"> (latest {{ updater.latest }})</span>
        </dd>
        <dt>Updates</dt>
        <dd>
          <template v-if="updateAvailable()">
            <span class="update-avail">{{ updater.latest }} is available</span>
            <a :href="updater.url" target="_blank" rel="noreferrer">Download</a>
            <span class="hint"> — installs over the old version, nothing is lost.</span>
          </template>
          <template v-else-if="updater.checking">Checking GitHub…</template>
          <template v-else-if="updater.checked && !updater.error">
            You're up to date.
          </template>
          <template v-else>
            <span class="hint">Couldn't reach GitHub.</span>
          </template>
          <button class="link-btn" :disabled="updater.checking" @click="checkForUpdate">
            Check now
          </button>
        </dd>
        <dt>Project</dt>
        <dd><a href="https://hometube.github.io">hometube.github.io</a></dd>
      </dl>
      <p class="hint">
        Your data is one folder — back it up any time with
        <code>ht export -o backup.ht</code>.
      </p>
    </details>
  </div>
</template>

<style scoped>
.settings { max-width: 720px; }
.sec {
  background: var(--panel); border: 1px solid var(--border); border-radius: 12px;
  padding: 0 16px; margin-bottom: 12px;
}
.sec summary {
  font-size: 14px; font-weight: 600; padding: 14px 0; cursor: pointer;
  list-style: none; display: flex; justify-content: space-between;
}
.sec summary::after { content: "›"; color: var(--muted); font-size: 16px; transition: transform 0.15s; }
.sec[open] summary::after { transform: rotate(90deg); }
.sec > *:not(summary) { margin-bottom: 12px; }
.sec[open] { padding-bottom: 16px; }
.update-avail { color: var(--accent); font-weight: 600; margin-right: 8px; }
button.link-btn {
  background: none; color: var(--muted); font-size: 12px; padding: 0 0 0 10px;
  text-decoration: underline; text-decoration-color: #59404f; font-weight: 400;
}
button.link-btn:hover { color: var(--text); background: none; filter: none; }
dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 16px; margin: 0; font-size: 14px; }
dt { color: var(--muted); }
dd { margin: 0; }
.toggle { display: flex; align-items: center; gap: 10px; font-size: 14px; cursor: pointer; }
.toggle input { accent-color: var(--accent); width: 16px; height: 16px; }
.sub-text { margin: 0 0 12px 26px; }
.job { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 3px 0; }
.job-label { width: 84px; color: var(--muted); flex: none; }
.bar { flex: 1; height: 6px; border-radius: 3px; background: var(--border); overflow: hidden; }
.fill { height: 100%; background-image: var(--grad); transition: width 0.4s; }
.fill.done { background: #3fb950; }
.fill.error { background: #db4d4d; }
.job-state { width: 110px; flex: none; color: var(--muted); }
.job-state.done { color: #56d364; }
.job-state.error { color: #ff7b72; }
.path {
  font-family: ui-monospace, monospace; font-size: 12px; word-break: break-all;
  background: var(--inset); border: 1px solid var(--border);
  padding: 8px; border-radius: 6px;
}
.path.small { display: inline-block; padding: 2px 8px; font-size: 11px; vertical-align: middle; }
.cookies select {
  background: var(--inset); color: var(--text); border: 1px solid var(--border);
  border-radius: 7px; padding: 5px 8px; font-size: 13px;
}
.sec-sub {
  font-size: 12px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.06em; color: var(--muted); margin: 16px 0 8px;
}
.cookies .actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.test-state { font-size: 13px; }
.test-state.ok { color: #56d364; }
.test-state.bad { color: #ff7b72; }
.sub { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 3px 0; }
.sub-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sub-count { color: var(--muted); }
pre {
  background: var(--inset); border: 1px solid var(--border); border-radius: 8px;
  padding: 12px; font-size: 12px; height: 240px; overflow-y: auto;
  white-space: pre-wrap; margin: 0;
}
.log-path { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
code { background: var(--inset); border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; }
</style>
