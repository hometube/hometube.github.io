# AGENTS.md

Instructions for AI agents working on the HomeTube project.

## Project Structure

```
hometube/
├── install.sh                # One-shot install: bun (if missing), server deps, ht command
├── install.ps1               # Windows one-shot install (PowerShell equivalent, experimental)
├── .github/workflows/
│   ├── deploy.yml            # GitHub Pages deploy (docs/ only — documentation site)
│   └── desktop.yml           # Desktop builds (macOS/Windows) + desktop-v* tag releases
├── server/                   # Bun + Hono server (the whole backend; no Python at runtime)
│   ├── src/
│   │   ├── index.ts          # Entry: tool PATH, schema, JWT secret, boot token, listen
│   │   ├── app.ts            # Hono factory, Env, auth middleware (loopback + pairing JWT)
│   │   ├── auth.ts           # HS256 JWT on WebCrypto, pairing tokens, lanIp
│   │   ├── db.ts             # bun:sqlite; SCHEMA byte-identical to the old SQLAlchemy DDL
│   │   ├── paths.ts          # data_dir/db/downloads resolution (env -> ~/.config/hometube/config.json -> ./data)
│   │   ├── cli.ts            # The `ht` command (port of backend/cli.py)
│   │   ├── hts.ts            # Shared .ht import core (used by HTTP route + CLI)
│   │   ├── watchdog.ts       # HOMETUBE_WATCH_PARENT ppid poll / HOMETUBE_WATCH_STDIN EOF
│   │   ├── routes/           # core.ts, library.ts, media.ts, podcasts.ts, files.ts, export.ts
│   │   └── services/         # ytdlp.ts (spawns yt-dlp CLI), downloader.ts (job queue),
│   │                         # scheduler.ts (subscription checks + auto-delete)
│   ├── parity.sh             # Response-level regression harness (see Verify loop)
│   ├── htcmp.py              # Structural .ht comparator (used by parity)
│   └── seed_parity.py        # Seeds both parity data dirs
├── desktop/                   # Tauri v2 desktop app (all-in-one server host + UI)
│   ├── src/                   # Vue 3 UI: wizard → shell (Home faces/shelves, Playlists,
│   │                          #   Devices pairing, Settings = owner diagnostics)
│   ├── src-tauri/             # Rust shell: spawns/monitors the server sidecar, kills on exit
│   ├── package.json
│   └── vite.config.js
├── mobile/                    # React Native companion app (Expo SDK 56)
│   ├── app/                   # Expo Router file-based routing
│   │   ├── _layout.tsx        # Root layout with providers
│   │   ├── index.tsx          # Entry → redirect to welcome or tabs
│   │   ├── welcome/
│   │   │   ├── setup-backend.tsx    # Server/local mode choice
│   │   │   └── setup-user.tsx       # User selection/creation
│   │   └── (tabs)/
│   │       ├── _layout.tsx          # Stack navigator (nav via hamburger menu only)
│   │       ├── videos/              # Video feed, add, channel, player
│   │       ├── music/               # Music home, add, playlist, now-playing
│   │       └── settings/            # Settings, backend URL, export, import
│   ├── src/
│   │   ├── providers/               # DataProvider, ServerProvider, LocalProvider
│   │   ├── stores/                  # Zustand stores (user, music, video, ui)
│   │   ├── db/localDb.ts            # SQLite wrapper (mirrors the server schema)
│   │   ├── services/                # react-native-track-player setup
│   │   ├── components/              # HamburgerMenu, LoadingSpinner, EmptyState
│   │   ├── api.ts                   # Provider proxy
│   │   └── types.ts                 # Shared TypeScript interfaces
│   ├── app.json / babel.config.js / tsconfig.json
├── docs/                      # GitHub Pages site (static, documentation-only landing)
└── data/                      # Local dev data (gitignored): db.sqlite + downloads/
```

Retired (kept in git history, tag `python-backend-final`): the Python/FastAPI
`backend/` and the Vue PWA `frontend/`. The desktop app replaced the PWA as
the shipped UI; GitHub Pages is documentation-only.

## Development Commands

### Server (Bun + Hono)
```bash
cd server
bun install
bun run src/index.ts       # Run server (PORT env var overrides 8000)
bunx tsc --noEmit          # Typecheck
./parity.sh                # Offline regression harness (needs python-backend-final checkout, see Verify loop)
```

### CLI (`bun server/src/cli.ts` or `ht` after install)
```bash
ht install                  # Install the ht command to ~/.local/bin
ht init                     # Interactive setup (data dir, default user)
ht login <user>             # Switch active user (creates if not exists)
ht pair                     # Mint a one-time pairing token for connecting a device
ht download <url>           # Auto-detect video/music, download, store
ht download <url> --playlist "name"  # Download music into specific playlist
ht download <url> --type music       # Force music type
ht export -o backup.ht      # Export .ht file for active user
ht export --week            # Export last 7 days
ht export --month           # Export last 30 days
ht export --day             # Export last 24 hours
ht import backup.ht         # Import .ht file
ht import --music <folder>  # Import local music files (ffprobe metadata; mp3/webm/flac/wav/m4a/ogg/aac)
ht songs [remove ID_OR_NAME]              # List/remove music for active user
ht playlists [remove|add|update ...]      # List/manage playlists
ht videos [remove|watched|keep ...]       # List/manage videos
ht podcasts                 # List podcast feeds and standalone (unsubscribed) episodes
ht settings get             # Show server settings (e.g. auto_download)
ht settings set <key> <value>  # Set a server setting (e.g. ht settings set auto_download off)
ht serve [--host H] [--port P] # Start the server
ht update                   # git pull + bun install + yt-dlp update
ht mobile --build           # Build the Android APK (release by default)
ht mobile --build --release # Build, then publish the APK as a GitHub Release
ht mobile --release         # Publish the newest built APK to a GitHub Release
ht mobile --deploy          # Install the built APK onto a connected device
ht build-server [--clean]   # Compile the desktop sidecar: bun build --compile -> server/dist/
ht fixart [--data-dir DIR]  # Backfill missing album art for downloaded music

# Release signing (optional, one-time). Without it, release builds fall back to
# the debug keystore. The mobile/plugins/withReleaseSigning config plugin wires
# these into the generated android/app/build.gradle; --release needs the gh CLI.
#   keytool -genkeypair -v -keystore hometube.keystore -alias hometube \
#       -keyalg RSA -keysize 2048 -validity 10000
#   # ~/.gradle/gradle.properties:
#   RELEASE_STORE_FILE=/abs/path/to/hometube.keystore
#   RELEASE_STORE_PASSWORD=...
#   RELEASE_KEY_ALIAS=hometube
#   RELEASE_KEY_PASSWORD=...
```

### Desktop (Tauri v2)
```bash
cd desktop
npm install
npm run tauri dev    # Dev: starts Vite + the app window; shell auto-starts the server from ../server
ht build-server      # sidecar (bun --compile -> server/dist/hometube-server)
npm run tauri build  # production bundle (embeds the sidecar; build it first)
```
The Rust shell (`desktop/src-tauri`) spawns the server as a child process, tails
its logs, and kills it on app exit. Sidecar resolution order: `HOMETUBE_SERVER`
(explicit binary) → dev checkout `../../server` run with bun from PATH or
`~/.bun` (or `HOMETUBE_SERVER_DIR` pointing at the server dir) → the sidecar
bundled under the app's resources (`Resources/hometube-server/hometube-server[.exe]`).
`tauri.conf.json` bundles `server/dist/` as a resource, so the sidecar build
must succeed before `tauri build`. Port: `HOMETUBE_PORT` (default 8000).
See `docs/tauri-desktop-plan.md`.

### Mobile (React Native / Expo)
```bash
cd mobile
npm install
npm start          # Start Expo dev server
npm run android    # Launch on Android
npm run ios        # Launch on iOS
npx tsc --noEmit   # TypeScript type check
```

### Verify loop (server)
```bash
cd server && bun install && bunx tsc --noEmit && ./parity.sh
```
`parity.sh` boots the Python backend (tag `python-backend-final` checkout of
`backend/`, port 8211) next to the JS server (port 8213) on seeded scratch data
copies and diffs every response; `PARITY_NET=1 ./parity.sh` adds live YouTube
calls (avoid back-to-back live runs — throttling). Never write to the repo
`data/`; parity uses seeded scratch copies under `$TMPDIR`.

## Code Conventions

- **Server**: TypeScript on Bun, Hono routes, `bun:sqlite` (no ORM), raw SQL
- **Desktop**: Tauri v2 (Rust shell) + Vue 3 UI
- **Mobile App**: React Native with Expo SDK 56, TypeScript, expo-router, Zustand
- **Icons**: @expo/vector-icons (Mobile)
- **Video Player**: expo-video (Mobile)
- **Audio Player**: react-native-track-player (Mobile)
- **API**: REST endpoints in `server/src/routes/*`; the mobile app calls through a provider proxy (`mobile/src/api.ts`)
- **Downloads**: yt-dlp CLI binary spawned in `server/src/services/ytdlp.ts` (progress parsed from `--newline` stderr; final file globbed by extractor `video_id`)
- **Provider Pattern**: `DataProvider` abstract interface; `ServerProvider` (HTTP) and `LocalProvider` (SQLite) in `mobile/src/providers/`. Mode flag `localMode`; all screens use the API proxy, never providers directly
- **`.ht` files**: Zip archives containing `metadata.json` (serialized DB tables) and subdirectories `videos/` and `music/` with media files

## API Endpoints

Implemented in `server/src/routes/`; responses mirror the original FastAPI
serialization exactly (booleans from 0/1, ISO datetimes with `.000000`
stripped only when microseconds are zero, parsed JSON columns) so existing
clients keep working.

### General
- `GET /api/status` - Health check (open, no auth — reports `pairing_required`)
- `GET /api/settings` - List server settings as key/value map
- `PUT /api/settings` - Set a server setting (body: key, value)
- `GET /api/downloads` - List background download jobs for active user: `[{id, type, item_id, user_id, status, progress, message, filename, error, created_at}]`. `status`: queued/running/done/error
- `GET /api/users` - List all users
- `POST /api/users` - Create user (body: name, image)

### Auth (LAN pairing)
Requests from the host itself (127.0.0.1/::1) are always allowed; LAN clients need a JWT.
- `POST /api/desktop/pair` - Mint a single-use pairing token (host-local only): `{token, expires_in, url}`
- `POST /api/auth/exchange` - Redeem a pairing token for a long-lived JWT (body: `{token}`)
- `ht pair` - CLI equivalent of `/api/desktop/pair` (works while the server runs; shares SQLite)
- Protected endpoints accept the JWT as `Authorization: Bearer` header or `?token=` query param (media URLs can't send headers)

### Videos
- `GET /api/videos?user_id=&filter=` - List videos (filter: all/my-feed/unwatched/keep)
- `POST /api/videos/add` - Add video (body: url, user_id, quality, playlist_id). YouTube playlist URLs bulk-add each entry; auto-creates a `kind:"video"` playlist and stores thumbnail/duration/filename
- `GET /api/videos/info?url=` - Get available formats for URL
- `GET /api/videos/{id}/qualities` - Get available qualities for a video
- `POST /api/videos/{id}/watch` - body: `{watched?: bool, position?: float}`. `watched:true` sets `watched_at` (clears `watched_at` on `false`); a bare POST no longer marks watched. Position-only body persists resume position
- `POST /api/videos/{id}/keep` - body: `{keep?: bool}` (defaults to true)
- `POST /api/videos/{id}/download` - Kick off async server download (body: quality). Returns `202 {job_id, queued}`; poll `GET /api/downloads`. De-duplicated: re-posting while a job runs returns the existing job
- `GET /api/videos/{id}/file` - Serve video file by DB id; if the file isn't on disk it waits for a running background job or lazy-downloads synchronously on first request. Correct MIME per extension, no-cache for Range streaming. Preferred over `/api/files/videos/...`
- `PUT /api/videos/{id}` - Update video metadata (channel_id, added_by, thumbnail, duration, position, quality)
- `DELETE /api/videos/{id}` - Delete video; also purges it from all video playlists and removes its server file

### Music
- `GET /api/music?user_id=` - List music
- `POST /api/music/add` - Add music (body: url, user_id, playlist_id)
- `GET /api/music/info?url=` - Get music info
- `POST /api/music/{id}/download` - Kick off async server download. Returns `202 {job_id, queued}`; poll `GET /api/downloads`
- `GET /api/music/{id}/file` - Serve music file with correct MIME type
- `PUT /api/music/{id}` - Update music metadata
- `DELETE /api/music/{id}` - Delete music

### Serving Files
- `GET /api/files/videos/{filename}` - Serve video files (video/mp4)
- `GET /api/files/music/{filename}` - Serve music files (auto-detects MIME: mp3, webm, m4a, ogg, flac, wav)

### Playlists
- `GET /api/playlists?user_id=` - List playlists
- `POST /api/playlists` - Create playlist
- `PUT /api/playlists/{id}` - Update playlist (name, user_id, songs — songs body used for reordering)
- `POST /api/playlists/{id}/add` - Add item to playlist (body: `{music_id}` or `{video_id, position, item_type:"video"}`). Video membership is `{video_id, position, type:"video"}`; music membership stays `{music_id, position}`
- `DELETE /api/playlists/{id}/remove/{item_id}?item_type=` - Remove item from playlist (item_type: music default, video)
- `DELETE /api/playlists/{id}` - Delete playlist

### Channels
- `POST /api/channels/add` - Add channel
- `GET /api/channels/{id}/videos` - Get channel videos
- `POST /api/channels/{id}/subscribe` - Subscribe with criteria
- `DELETE /api/subscriptions/{id}` - Unsubscribe

### Podcasts
- `GET /api/podcasts?user_id=` - List subscribed podcast feeds (subscription-backed only)
- `GET /api/podcasts/episodes?user_id=` - List standalone podcast episodes not tied to a subscription feed (single downloads)
- `POST /api/podcasts/subscribe` - Subscribe to a podcast feed
- `GET /api/podcasts/{sub_id}/episodes` - List episodes for a subscribed feed
- `POST /api/podcasts/{sub_id}/check` - Force a manual feed refresh
- `DELETE /api/podcasts/{sub_id}` - Unsubscribe

### Export / Import
- `POST /api/export` - Export database as .ht file (body: type, user_id, date_from, date_to, video_ids, music_ids)
- `POST /api/import` - Import .ht file into database (multipart file upload)

## Notes

- **One library, one data dir**: all paths (DB, downloads, file serving) are resolved by `server/src/paths.ts` from `data_dir` in `~/.config/hometube/config.json` (see `ht init`); `ht serve`, `ht download`/`ht` CLI commands, `index.ts`, `ytdlp.ts`, and `scheduler.ts` all share the same data dir by default. `DB_PATH`/`DATA_DIR`/`DL_DIR` env vars override it.
- Scheduler runs in background checking subscriptions every 60 seconds
- **Background downloads**: server-side downloads run on a worker queue (`server/src/services/downloader.ts`, 2 workers) spawned via `yt_dlp` CLI with progress → job registry. API endpoints return `202 {job_id}`; clients poll `GET /api/downloads` (status + 0-100 progress) via `mobile/src/downloads.ts` (`waitForServerDownload`). Completed jobs write `filename`/`downloaded` back to the DB row. The lazy `/videos/{id}/file` and `/music/{id}/file` paths single-flight off an existing job (wait for it) instead of starting a duplicate download
- **Pre-download on add**: the `auto_download` server setting (default on) makes add endpoints queue a background download for every added video/music/podcast, so items are usually ready to play instantly. The scheduler also pre-warms newly-detected subscription items, and podcast feed backfill pre-warms only the newest 3 episodes (avoiding mass downloads on subscribe). Turn off with `ht settings set auto_download off` or `PUT /api/settings` `{key:"auto_download", value:"off"}` — lazy on-play downloads remain as fallback
- Auto-delete: Videos watched >7 days ago without keep_flag are deleted
- Music downloads preserve original format (mp3, webm, m4a, ogg, flac, wav) via yt-dlp
- **Video experience** equals the music/podcast model: videos carry `thumbnail`, `duration`, `filename`, `position` (resume point, seconds) alongside `watched_at`. Auto-watch at ~95% / ended. `kind:"video"` playlists; mobile player resumes from `position`, flushes progress (30s), auto-watches on `playToEnd`
- Offline: mobile caches metadata in its SQLite local DB; device cache/download flags marked on the video row

### Server Mode vs Local Mode (mobile)

The mobile app can operate in two modes:

- **Server Mode** (default): Connects to the Bun server via HTTP (`ServerProvider`, backend URL in app storage). Supports LAN pairing via QR token.
- **Local Mode**: Fully offline with SQLite (`hometube-local.db`, `LocalProvider`). Media stored as files; `.ht` imports populate the DB.

Users choose the mode on the welcome `setup-backend` screen. Mode can be toggled later in Settings.

### `.ht` File Format

`.ht` files are zip archives used to transfer HomeTube data between instances and into mobile local mode. Structure inside the zip:

```
file.ht
├── metadata.json   # JSON: version, exported_at, users[], channels[], subscriptions[], videos[], music[], playlists[], settings[]
├── videos/
│   ├── abc123.mp4
│   └── ...
└── music/
    ├── song.mp3
    └── ...
```

Export sources: `POST /api/export` endpoint; `ht export` CLI.
Import targets: `POST /api/import` endpoint; `ht import` CLI; mobile local-mode import.

### Intentional divergences from the retired Python backend

- Unknown `/api/*` paths return JSON 404 (Python had an SPA catch-all); `PUT` endpoints return the updated row; `/api/files/*` and `.ht` zip extraction have path-traversal guards; the JS scheduler keeps ticking after errors; export sends `content-length` (Python chunked)
- CLI music metadata uses **ffprobe** instead of mutagen
- Naive-UTC DB writes carry 6 fractional digits to match `datetime.utcnow()` formatting
- Python quirks kept for parity: `timedelta.seconds` mod-86400 date-window semantics; channels never deduped on import; settings import is insert-only with `jwt_secret` skipped; dangling `playlist_id` yields 500
- bun 1.1.15 quirks: hono/cors re-wraps responses (breaks sliced-BunFile bodies), `BunFile.slice()` stream/arrayBuffer ignore the window, explicit content-length dropped on stream bodies → media range responses use explicit `node:fs` positional reads into a buffered `Uint8Array`

- No test framework; the parity harness (`server/parity.sh` + `htcmp.py`) is the regression net
