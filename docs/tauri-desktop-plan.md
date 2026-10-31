# HomeTube Desktop — Tauri App Plan

## 1. Vision

The PWA was meant to be the mobile experience, but Android kills background playback
(queue won't advance without the page focused / receiving input). That role is now filled by
the React Native app. The PWA's remaining value is zero-to-low.

**New product shape:**

- **HomeTube Desktop (Tauri)** — the one thing a user installs on their server machine. It:
  1. Runs the HomeTube backend (server + scheduler + download queue) with no terminal needed.
  2. Pairs the mobile app via QR code (LAN URL + one-time pairing token).
  3. Serves the mobile app itself: link/QR to the latest APK on GitHub Releases, with update
     notifications.
  4. Manages everything: users, library (videos/music/podcasts/playlists), download queue,
     storage, `.ht` export/import, settings, logs.
- **HomeTube Mobile (React Native)** — unchanged role: client to the desktop-hosted server.
- **PWA** — retired entirely (see §8). The `hometube.github.io` site becomes
  documentation-only; all app downloads live on GitHub Releases.

## 2. Current-state assessment

| Area | State | Impact |
|---|---|---|
| `backend/main.py` (~1,520 LOC) | Full REST API, JWT auth, static file serving | API contract is stable; both frontends + CLI depend on it. Must stay wire-compatible. |
| `backend/services/` | `ytdlp.py` (subprocess **and** Python-API usage), `downloader.py` (thread pool + job registry), `scheduler.py` (subscription checks, auto-delete) | All portable, but `sys.executable -m yt_dlp` breaks in frozen/packaged Python (§4.2). |
| `backend/cli.py` (~1,810 LOC) | init/login/download/export/import/settings/mobile | Mostly superseded by the Desktop UI; export/import logic must survive in some form. |
| Storage | SQLite (`db.sqlite`) + `downloads/` dir, all resolved by `paths.py` from `~/.config/hometube/config.json`, overridable via `DB_PATH`/`DATA_DIR`/`DL_DIR` | **Already language-agnostic.** A Node backend or another machine can open the same folder with zero migration. |
| Auth | JWT + `POST /api/auth/exchange`. The temporary-token path is ngrok-based (dev only); production mode currently allows all requests (`current_ngrok_token` unset). | ngrok is **dropped from scope**; the exchange primitive is kept and pairing becomes the sole auth mechanism (§D5). |
| Mobile | `ServerProvider.exchangeToken()`, `backendUrl` in SecureStore, manual URL entry in `welcome/setup-backend.tsx` | Needs QR scanning + deep-link handling to consume the pairing QR (§7). |
| PWA frontend | Vue 3 + Vite + Pinia + Tailwind, provider pattern with local/IndexedDB mode | Its pages/components/stores seed the Desktop UI's foundation. PWA plugin + local mode drop away. |

## 3. Key decisions

### D1 — Tauri v2, Rust shell, Vue 3 UI

- Rust core handles what only the shell can: sidecar process lifecycle, auto-update,
  native file dialogs, tray, single-instance, firewall prompts (Windows), LAN IP discovery.
- UI stays Vue 3 — seeded from `frontend/` components, stores, and the existing
  `ServerProvider` (talks to `http://127.0.0.1:<port>` over plain HTTP; drop the provider
  abstraction and local mode on desktop). Seeding is copy-into-`desktop/`, see §8.

### D2 — Backend runtime: sidecar Python first, Node migration gated as a later step

Options considered:

| Option | Pros | Cons |
|---|---|---|
| **A. Ship existing FastAPI backend as a Tauri sidecar** (PyInstaller onedir build) | Zero rewrite; yt-dlp Python API + progress hooks keep working; ships in days not months | Bundled Python binary adds ~40–80 MB; PyInstaller on Windows is a common Defender false-positive source; macOS signing/notarizing nested binaries is fiddly; per-platform CI builds needed |
| B. Rewrite backend in TypeScript (Fastify + better-sqlite3), bundle official standalone `yt-dlp` binary | One language across the whole product (mobile + UI are already TS); Bun compile or `pkg` sidecar is cleaner to sign; yt-dlp updated independently of app releases | Rewrite of ~2.5k LOC of proven backend; progress parsing moves from Python hooks to `--progress-template` stdout parsing (well-trodden, used by other GUI downloaders) |
| C. Backend in Rust (axum + tauri commands) | Smallest footprint | Largest rewrite; yt-dlp still an external process; least team familiarity |

**Decision: A first, with B explicitly gated.** Rationale:

- The DB, downloads folder, `.ht` format, and HTTP API are the real product surface — all
  are language-independent and frozen by mobile compatibility. Swapping the sidecar's
  implementation later is invisible to users, so the decision is reversible.
- The desktop app's risky/novel parts are packaging, lifecycle, pairing, and updates — not
  backend language. Validate those with the backend we already trust.
- **Trigger to execute B** (any one of): Defender false positives we can't whitelist around;
  PyInstaller CI proves unmaintainable across macOS/Windows/Linux targets; we need a backend
  feature where TS tooling is materially better; or the desktop UX is validated and we want
  long-term single-language maintenance.

If B happens: Fastify routes mirror `main.py` 1:1; `better-sqlite3` (or Drizzle) reads the
existing `db.sqlite` with `PRAGMA user_version` migrations; `mutagen` → `music-metadata`;
`PyJWT` → `jose`; `qrcode` Python → `qrcode` npm (or generate QR in the Vue UI);
`yt-dlp` → bundled standalone binary invoked like today's subprocess path (already how most
of `ytdlp.py` works), with `--js-runtimes node` pointing at the runtime the app ships.

### D3 — Same data layout, zero migration

Desktop uses `paths.py` resolution unchanged: `~/.config/hometube/config.json` → `data_dir`
→ `db.sqlite` + `downloads/`. Users who ran the CLI/server before get their library
instantly on first launch. The Rust shell passes `DATA_DIR` only when the user picks a
custom folder in onboarding (which then rewrites `config.json`).

### D4 — Server lifecycle owned by the Rust shell

- Rust spawns the sidecar with a fixed free port (probe 8000, fall back to ephemeral),
  polls `GET /api/status` until healthy, captures stdout/stderr to a rolling log file.
- Single-instance guard (`tauri-plugin-single-instance`): reopening the app focuses the
  window instead of starting a second server (protects SQLite + the port).
- Tray icon with status; quit kills the child process cleanly (process group kill on Unix,
  Job Object on Windows).
- Server can be paused/stopped from the UI without quitting.

### D5 — Auth = LAN pairing (ngrok removed)

**ngrok is out of scope and deleted outright**: `pyngrok` from `requirements.txt`, the
dev-mode tunnel block in `main.py` (`current_ngrok_url`/`current_ngrok_token`, terminal QR
print — QR generation moves to the Desktop UI), `run-dev.sh`'s tunnel logic, the ngrok-token
fallback branches in `/api/status`, `verify_token`, and `/api/auth/exchange`, and the
"http/ngrok" mode prompt in `cli.py`. This lands as one cleanup PR before sidecar work
begins (§10, M0).

With ngrok gone, the auth model is **pairing-only** (desktop binds `0.0.0.0` so mobile can
reach it, so the "production allows everything" path is deleted, not flagged):

- The desktop shell owns a long-lived host secret (generated on first run, stored in the
  OS keychain or a settings row) and passes it to the sidecar via env, so the server always
  runs in enforced mode.
- **Pairing**: the shell calls `POST /api/desktop/pair` (accepted from localhost only) to
  mint a single-use pairing token (5-min TTL). Mobile redeems it via the existing
  `POST /api/auth/exchange` and receives the long-lived JWT it already stores today —
  no `ServerProvider` change beyond initial acquisition.
- Every LAN request without a valid JWT gets a 401. `/api/status` stays reachable
  unauthenticated so an unpaired phone can discover "HomeTube here, pairing required".
- The Connect screen always shows the pairing URL + token as text next to the QR, so
  manual entry works (also covers older mobile builds predating the scanner).
- Device revocation: issued JWTs get an id (`jti`); a revocation list lives in the
  settings table and is checked in `verify_token`.

### D6 — GitHub Releases is the only update channel

- Desktop: `tauri-plugin-updater` reading `latest.json` from the repo's releases
  (signature-verified). Checks on launch + manual check button.
- Mobile APK: Desktop shows the latest release (name, changelog, size, QR + link for the
  APK download URL) via GitHub API (`/repos/:owner/:repo/releases/latest`, optional token
  for rate limits). Mobile itself also gets a "new version available" check against the same
  endpoint (small follow-up in the mobile app).

## 4. Packaging (Option A details)

### 4.1 Sidecar build

- PyInstaller **onedir** (not onefile: faster startup, simpler signing, better Defender
  behavior) producing `hometube-server` per target triple; registered in `tauri.conf.json`
  under `bundle.externalBin`.
- Hidden imports for FastAPI/uvicorn/sqlalchemy; ship `services/` as-is. `pyngrok` is gone
  from `requirements.txt` entirely (§D5); remote access stays user-side (reverse proxy /
  Tailscale), documented on the docs site rather than tunneled by the app.

### 4.2 Frozen-mode fixes in the backend (pre-work)

- `ytdlp.py:YTDLP_CMD = [sys.executable, "-m", "yt_dlp"]` breaks when frozen
  (`sys.executable` is the app binary). Fix: detect frozen mode and route **all** yt-dlp
  calls through the bundled **standalone yt-dlp binary** instead. This also decouples
  yt-dlp updates from app releases (a real operational win — YouTube breaks extractors
  regularly): the app can offer "update yt-dlp now", downloading the latest standalone
  release into `data_dir/bin/yt-dlp`.
- Every subprocess invocation must pass a controlled `PATH` containing the bundled
  `ffmpeg`/`ffprobe` and a JS runtime (`node` — required for current YouTube extraction;
  the app ships `node` and passes `--js-runtimes node:<path>` in `YTDLP_YT_ARGS`).

### 4.3 Bundled binaries (all platforms)

| Binary | Why | Update story |
|---|---|---|
| `hometube-server` | the API (PyInstaller sidecar) | with the app (v1), independent later (Option B) |
| `yt-dlp` (standalone) | extraction/downloads | auto-updatable from GitHub releases, independent of app |
| `ffmpeg` + `ffprobe` | audio conversion, thumbnail embedding | bundled static builds; refresh with app releases |
| `node` (LTS) | yt-dlp JS runtime | bundled; refresh with app releases |

## 5. Desktop UI — screens

Built in `desktop/` (new Tauri project; Vite + Vue 3, reusing `frontend/src` components and
`stores/` where they fit; plain HTTP calls to the sidecar — no provider abstraction).

1. **First run / onboarding**
   - Pick data folder (or adopt existing `~/.config/hometube` install — detect and offer).
   - Server starts automatically; shows LAN URL.
2. **Dashboard** — server status (running/paused, port, uptime), library counts, disk usage
   of `data_dir`, active/queued downloads with progress, recent activity.
3. **Connect Phone** (headline screen)
   - QR encoding `hometube://pair?url=http://<lan-ip>:<port>&token=<one-time>` + copyable
     plain URL/token fallback for manual entry.
   - List of paired devices (JWTs issued; revocation list in the settings table).
   - Regenerate / revoke actions.
4. **Mobile App** — latest version card from GitHub Releases: version, changelog, size;
   QR + link for the APK; "check for updates"; red-dot when mobile-latest > installed
   guidance.
5. **Library** — tabs Videos / Music / Podcasts / Playlists reusing existing list UI ideas:
   add-by-URL (quality picker), bulk delete, keep/watched toggles, storage column, open-in-
   file-manager, `.ht` export (native save dialog) / import (native file dialog).
6. **Users** — create/list, per-user library stats, delete with data cascade confirmation.
7. **Downloads** — live job queue (`GET /api/downloads` polling, SSE later), retry failed,
   global pause, `auto_download` toggle.
8. **Subscriptions** — channels, criteria editing, force check, last-checked timestamps.
9. **Settings** — port, start-on-login, start-server-on-launch, tray behavior, data folder,
   update channel (check now / release notes), yt-dlp version + update button, optional
   GitHub token for release checks, logs viewer with reveal-in-folder.

## 6. API additions (backend)

Small, additive surface:

- `POST /api/desktop/pair` → `{token, expires_at, qr_payload}` (one-time pairing token;
  host-only endpoint, i.e. requires the local host secret or 127.0.0.1 origin)
- `GET /api/desktop/info` → LAN URLs, version, library stats, disk usage, yt-dlp version
- `GET/DELETE /api/desktop/devices` → list/revoke issued tokens
- `GET /api/desktop/logs?file=&tail=` → sidecar log tail
- `PUT /api/settings` gains `pairing_enabled`, host secret bootstrap
- Existing `POST /api/auth/exchange` redeems desktop pairing tokens (it replaces the
  removed ngrok-token flow; request/response shape unchanged for mobile).

## 7. Mobile-side work (small, separate PRs)

- QR scanner on `welcome/setup-backend.tsx` (expo-camera / vision-camera) parsing the
  `hometube://pair?...` payload → auto-fill URL + `exchangeToken()` → drop into user select.
- Deep-link scheme `hometube://` in `app.json` so tapping the link on the same phone works too.
- "Update available" check against GitHub Releases (shown in settings).

## 8. PWA & GitHub Pages disposition

- **The PWA is retired.** `frontend/` stops shipping installable-app behavior
  (`vite-plugin-pwa` manifest + service-worker registration removed).
- **GitHub Pages becomes documentation-only.** `.github/workflows/deploy.yml` stops
  building/serving the Vue app; Pages serves documentation instead (rendered `docs/` or a
  lightweight docs site). Download links point at GitHub Releases.
- `desktop/` (decided) is a fresh Tauri project scaffolded in this repo, **seeded by
  copying** the reusable `frontend/src` components/stores it wants rather than live
  cross-package imports — `desktop/` stays self-contained and `frontend/` can be deleted
  cleanly at M4.
- Local/IndexedDB mode is desktop-irrelevant (mobile keeps its own local mode + `.ht`
  import/export).
- `AGENTS.md` is updated alongside each milestone that changes structure (ngrok removal,
  `desktop/` layout, PWA removal, Pages repurpose).

## 9. CI/CD (GitHub Actions)

- `release-desktop.yml`: matrix `[macos-latest (aarch64), macos-13 (x86_64), windows-latest,
  ubuntu-latest]` → build sidecar (PyInstaller) + bundled binaries + `tauri build` →
  publish `.dmg`, `.app.tar.gz` + `latest.json`, `.msi` (+ NSIS), `.AppImage`/`.deb`.
- Signing is free-only (no Apple Developer ID, no OV/EV cert — §12): CI ad-hoc signs all
  bundled/nested binaries (`codesign -s -`), signs the Tauri bundle + updater payload with
  the locally-generated updater keypair, and release notes carry the one-time first-launch
  bypass instructions for macOS and Windows.
- `release-mobile.yml` (extends existing `ht mobile --release`): APK upload with changelog;
  desktop's "Mobile App" screen picks it up automatically.
- Retarget `.github/workflows/deploy.yml`: no frontend build; publish documentation to
  Pages only (§8).
- Sidecar + bundled-binary versions recorded in `GET /api/status` output for diagnostics.

## 10. Milestones

Progress: M0 complete (auth switch + scaffold, verified end-to-end). M1 mostly landed:
QR pairing screen, port fallback + external-server adoption, disk logs (rolling,
path in UI), single-instance + dock reopen, data-folder onboarding (shared
config.json with CLI, live restart on change, adopt-existing via folder picker),
tray + close-to-hide. Remaining M1: PyInstaller sidecar packaging (yt-dlp frozen
fix, bundled ffmpeg/node) + Settings polish.

- **M0 — De-risk (spike)** — ngrok purge PR (code, `requirements.txt`, `run-dev.sh`,
  `cli.py` prompts) and `verify_token`/`exchange` switched to pairing-only enforcement
  (§D5); Tauri v2 scaffold in `desktop/`; spawn a plain uvicorn sidecar on macOS +
  Windows; health-check + kill-on-exit. *Exit: mobile app on LAN connects to the sidecar
  started by the app, unpaired LAN clients get 401.*
- **M1 — Core shell** — lifecycle done right (single instance, tray, logs, port fallback),
  Dashboard + Settings (data folder onboarding + adopt-existing-install), yt-dlp/ffmpeg/node
  bundling + frozen-mode fixes in `ytdlp.py`.
- **M2 — Pairing + app distribution** — pair endpoint + QR screen + token revocation; mobile
  QR scan + deep link; GitHub Releases mobile-app screen; desktop updater wired to releases
  (unsigned/dev channel acceptable pre-signing).
- **M3 — Full management UI** — Library, Users, Downloads, Subscriptions, export/import with
  native dialogs.
- **M4 — Release engineering** — free signing path (ad-hoc macOS signing + updater keypair,
  first-launch bypass docs), full CI matrix, first public release
  (v0.1 desktop), delete `frontend/` PWA, retarget Pages to docs-only (§8).
- **M5 — (Gated, §D2) Node backend migration** — only if trigger conditions are met:
  Fastify mirror of the API, `better-sqlite3` on the same file, standalone yt-dlp, sidecar
  swap behind the identical lifecycle contract.

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Windows Defender flags PyInstaller sidecar | onedir + authenticode signing; keep Option B (Bun/pkg) warm — it's the escape hatch by design |
| macOS blocks nested binaries (unsigned app) | Ad-hoc-sign every nested binary (mandatory on Apple Silicon, free); document one-time quarantine bypass; verify on a clean machine before release |
| YouTube extractor rot strands users between app releases | standalone yt-dlp binary, "update yt-dlp" button, auto-update check on app launch |
| Enforced pairing-only auth breaks existing manual-URL mobile setups | Pairing token is shown as text for manual redemption via the existing `exchangeToken` flow; mobile and desktop ship together in M2; docs site explains re-pairing |
| Port conflicts / two instances corrupt SQLite | single-instance plugin + port probing + lock file with PID in `data_dir` |
| Corporate/restricted networks block mDNS-like discovery | we don't need discovery — QR carries the explicit IP:port; manual entry fallback stays |
| Scope creep (remote access, streaming, multi-host) | explicitly out of scope for v1: LAN only; remote = user-side reverse proxy/Tailscale docs |

## 12. Open questions

Resolved: ~~repo layout~~ (`desktop/` in this repo), ~~ngrok~~ (dropped entirely, §D5),
~~Pages role~~ (documentation-only, §8), ~~export/import sharing~~ (fold into
`backend/core/` during M3), ~~tray~~ (basic/standard behavior only for v1),
~~on-LAN APK hosting~~ (deferred — GitHub Releases link is sufficient for v1; revisit if
users ask for phone-side downloads without GitHub access).

   - **Signing: no paid certs (decided)**. Small userbase tolerates the one-time bypass.
     Mitigations are free and scripted: ad-hoc sign everything on macOS
     (`codesign -s -`, required on Apple Silicon for nested sidecar/node/ffmpeg binaries),
     keep the Tauri updater keypair for auto-updates, and document the one-time first-launch
     step (macOS: right-click → Open, or `xattr -dr com.apple.quarantine`; Windows:
     SmartScreen → More info → Run). If unsigned Windows/Defender friction ever gets loud,
     Option B (Bun/pkg sidecar) is the escape hatch — PyInstaller is the usual
     false-positive source, not Tauri itself.
