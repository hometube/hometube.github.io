// Update checks against GitHub Releases. Releases published from `desktop-v*`
// tags are installers (DMG/MSI), not signed delta payloads, so the check only
// tells the user a newer version exists and links to the download — no
// tauri-plugin-updater key material needed. Checked once at startup and on
// demand from Settings.
import { reactive } from "vue";
import { getVersion } from "@tauri-apps/api/app";

const REPO = "hometube/hometube.github.io";

export const updater = reactive({
  current: "",
  latest: null, // version string of the newest desktop-v* release, or null
  url: "", // release page for the latest version
  checked: false, // a check completed (found one or not)
  checking: false,
  error: false,
});

// Plain semver compare: >0 when a is newer than b. Ignores pre-release tags.
function semverGt(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

export async function checkForUpdate() {
  if (updater.checking) return;
  updater.checking = true;
  updater.error = false;
  try {
    if (!updater.current) updater.current = await getVersion().catch(() => "");
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    for (const r of await res.json()) {
      const tag = String(r.tag_name || "");
      if (!tag.startsWith("desktop-v")) continue;
      const v = tag.replace(/^desktop-v/, "").split("-")[0];
      if (!updater.latest || semverGt(v, updater.latest) > 0) {
        updater.latest = v;
        updater.url = r.html_url || `https://github.com/${REPO}/releases/tag/${tag}`;
      }
      break; // releases come newest-first; first desktop-v* is the latest
    }
    updater.checked = true;
  } catch {
    // Offline or rate-limited: leave the previous state, surface in Settings.
    updater.error = true;
  }
  updater.checking = false;
}

export function updateAvailable() {
  return !!(updater.latest && updater.current && semverGt(updater.latest, updater.current) > 0);
}
