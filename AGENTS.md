# AGENTS.md

Instructions for AI agents working on the HomeTube project.

## Project Structure

```
hometube/
├── install.sh                # One-shot install: venv, deps, frontend build, ht command
├── install.ps1               # Windows one-shot install (PowerShell equivalent)
├── .github/workflows/
│   └── deploy.yml            # GitHub Actions deploy workflow
├── backend/
│   ├── main.py               # FastAPI app with REST endpoints
│   ├── models.py             # DB models (User, Video, Music, Channel, Subscription, Playlist)
│   ├── database.py           # SQLite configuration (DB path resolved via paths.py)
│   ├── paths.py              # Single source of truth for data_dir/db/downloads (reads ~/.config/hometube/config.json)
│   ├── cli.py                # CLI: install, init, login, download, export/import, songs, playlists, videos
│   ├── cli.sh                # Helper script: manages venv and installs ht command
│   ├── cli.ps1               # Windows PowerShell equivalent of cli.sh
│   ├── run-dev.sh            # Dev runner with ngrok tunnel
│   ├── import_music.py       # Import local music files (supports mp3, webm, flac, wav, m4a, ogg)
│   ├── requirements.txt      # Python dependencies
│   └── services/
│       ├── ytdlp.py          # yt-dlp wrapper for downloads (preserves audio format)
│       └── scheduler.py      # Background subscription checker + auto-delete
├── frontend/
│   ├── src/
│   │   ├── App.vue           # Main Vue app with slide-out nav menu
│   │   ├── api.js            # API proxy – delegates to active provider (server or local)
│   │   ├── localDb.js        # IndexedDB wrapper (hometube-local DB with 8 object stores)
│   │   ├── providers/
│   │   │   ├── DataProvider.js    # Abstract provider interface
│   │   │   ├── ServerProvider.js  # HTTP provider – talks to FastAPI backend
│   │   │   ├── LocalProvider.js   # IndexedDB provider – offline mode
│   │   │   └── index.js          # Provider factory (detect mode, build, switch)
│   │   ├── components/
│   │   │   ├── GlobalMusicPlayer.vue  # Persistent mini-player across the app
│   │   │   ├── WaveformVisual.vue     # Audio waveform visualization
│   │   │   ├── BackendMenu.vue        # Backend URL configuration modal
│   │   │   ├── PlaylistMenu.vue       # Playlist context menu
│   │   │   └── SongMenu.vue           # Song context menu
│   │   ├── pages/
│   │   │   ├── UserPage.vue           # User selection/creation
│   │   │   ├── SetupUser.vue          # User setup wizard
│   │   │   ├── SetupBackend.vue       # Initial setup: choose server or local mode
│   │   │   ├── VideoHome.vue          # Video feed, filters, in-app player (Plyr.js)
│   │   │   ├── AddVideo.vue           # Add video by URL with quality selection
│   │   │   ├── AddChannel.vue         # Browse channel videos / subscribe with rules
│   │   │   ├── MusicHome.vue          # Playlists view with My Songs/All Songs virtual playlists
│   │   │   ├── AddMusic.vue           # Add music by URL, create/select playlist
│   │   │   ├── PlaylistView.vue       # Full music player: album art, play/shuffle, controls
│   │   │   ├── ExportPage.vue         # Export data as .ht file
│   │   │   ├── ImportPage.vue         # Import .ht file into local mode
│   │   │   ├── SettingsPage.vue       # Settings with server/local mode toggle
│   │   │   ├── DebugPage.vue          # Debug/info page
│   │   │   └── AboutPage.vue          # App info and version
│   │   ├── stores/
│   │   │   ├── music.js       # Pinia store (music state, playback queue)
│   │   │   ├── video.js       # Pinia store (video state)
│   │   │   ├── user.js        # Pinia store (user state)
│   │   │   └── errors.js      # Pinia store (error tracking)
│   │   └── style.css
│   ├── package.json
│   └── vite.config.js         # Vite + PWA config
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
│   │   ├── stores/
│   │   │   ├── userStore.ts         # User state (Zustand)
│   │   │   ├── musicStore.ts        # Music playback (react-native-track-player)
│   │   │   ├── videoStore.ts        # Video state
│   │   │   └── uiStore.ts          # UI state (menu, navigation)
│   │   ├── db/localDb.ts           # SQLite wrapper (9 tables mirroring IndexedDB stores)
│   │   ├── services/
│   │   │   ├── trackPlayerService.ts # Background audio service
│   │   │   └── playerSetup.ts       # TrackPlayer registration
│   │   ├── components/
│   │   │   ├── HamburgerMenu.tsx    # Slide-out navigation menu
│   │   │   ├── LoadingSpinner.tsx
│   │   │   ├── EmptyState.tsx
│   │   │   └── index.ts            # Component re-exports
│   │   ├── api.ts                  # Provider proxy (same pattern as frontend/)
│   │   └── types.ts               # Shared TypeScript interfaces
│   ├── app.json                   # Expo config (plugins, permissions, splash)
│   ├── babel.config.js            # Babel config with module-resolver for @/ alias
│   └── tsconfig.json              # TypeScript config with path aliases
└── data/
    ├── db.sqlite            # SQLite database
    └── downloads/           # Downloaded media files
```

## Development Commands

### Backend
```bash
cd backend
pip install -r requirements.txt
python main.py               # Run server (add --dev for ngrok tunnel)
python import_music.py --folder /path --user-id 1  # Import local music
```

### CLI (`python cli.py` or `ht` after install)
```bash
cd backend
python cli.py install         # Install `ht` command to ~/.local/bin
ht init                       # Interactive setup (data dir, default user, mode)
ht login <user>               # Switch active user (creates if not exists)
ht download <url>             # Auto-detect video/music, download, store
ht download <url> --playlist "name"  # Download music into specific playlist
ht download <url> --type music       # Force music type
ht export -o backup.ht        # Export .ht file for active user
ht export --week              # Export last 7 days
ht export --month             # Export last 30 days
ht export --day               # Export last 24 hours
ht import backup.ht           # Import .ht file
ht songs                      # List music for active user
ht playlists                  # List playlists for active user
ht videos                     # List videos for active user
ht podcasts                   # List podcast feeds and standalone (unsubscribed) episodes
ht settings get               # Show server settings (e.g. auto_download)
ht settings set <key> <value> # Set a server setting (e.g. ht settings set auto_download off)
ht build                      # Build the Android app (release by default)
ht deploy                     # Install the built app onto a connected device
```

### Frontend (Vue PWA)
```bash
cd frontend
npm install
npm run dev        # Dev server
npm run build      # Production build
```

## Running as a systemd service (Linux)

The backend is the whole server: FastAPI + background scheduler (`services/scheduler.py`) + the async download queue (`services/downloader.py`). Playwright is not required; only the Python venv (`yt-dlp` runs via `python -m yt_dlp`, no separate binary needed). On a headless Linux box:

```ini
# /etc/systemd/system/hometube.service
[Unit]
Description=HomeTube backend server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=hometube
WorkingDirectory=/opt/hometube/backend
ExecStart=/opt/hometube/backend/.venv/bin/python main.py
# Restart on transient failure so the server self-heals
Restart=on-failure
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload && systemctl enable --now hometube
# Tail logs / check health
journalctl -u hometube -f
curl -s http://localhost:8000/api/status
```

Notes:
- All paths resolve from `data_dir` in `~/.config/hometube/config.json` (`ht init`) — point `User=` so `~` resolves to the right home, or override with `DB_PATH`/`DATA_DIR`/`DL_DIR` env vars.
- The scheduler + downloader use **threads inside the one process**, so don't run more than one systemd instance of `main.py` (SQLite + port conflict). One unit = the full server.
- `install.sh`/`cli.sh` require `#!/bin/bash` (Debian/Ubuntu ships `/bin/bash`); Alpine/busybox boxes need `bash` installed. On Windows use `install.ps1`/`cli.ps1` instead.
- If you need ngrok tunneling (mobile access from outside), run `main.py --dev` under the service instead — or keep the domain/reverse-proxy outside systemd.

## Running on Windows

Prerequisites (winget): Python 3.10+ (`Python.Python.3.12`), Node.js LTS (`OpenJS.NodeJS.LTS`), ffmpeg (`Gyan.FFmpeg`), and a JS runtime for YouTube (`DenoLand.Deno`). `yt-dlp` itself is installed by pip into the venv.

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1   # venv + deps + frontend build + ht
cd backend ; . .\cli.ps1                               # activate the venv in this shell
python main.py                                         # run the server
```

`ht` installs to `%USERPROFILE%\.local\bin\ht.cmd` and `cli.py install` adds that folder to the user PATH automatically (restart the terminal to pick it up). Config lives at `%USERPROFILE%\.config\hometube\config.json`; same `DB_PATH`/`DATA_DIR`/`DL_DIR` env overrides apply.

To run the server in the background, register a scheduled task (runs at logon, restarts on failure):

```powershell
$action = New-ScheduledTaskAction -Execute "C:\hometube\backend\.venv\Scripts\python.exe" `
    -Argument "main.py" -WorkingDirectory "C:\hometube\backend"
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName HomeTube -Action $action -Trigger $trigger -Settings $settings
```

### Mobile (React Native / Expo)
```bash
cd mobile
npm install
npm start          # Start Expo dev server
npm run android    # Launch on Android
npm run ios        # Launch on iOS
npx tsc --noEmit   # TypeScript type check
```

## Code Conventions

- **Backend**: Python with FastAPI, SQLAlchemy ORM, SQLite
- **Frontend (PWA)**: Vue 3 Composition API, Tailwind CSS for styling
- **Mobile App**: React Native with Expo SDK 56, TypeScript, expo-router
- **Icons**: Font Awesome via @fortawesome/vue-fontawesome (PWA) / @expo/vector-icons (Mobile)
- **Video Player**: expo-video (Mobile); PWA uses a persistent custom `<video>` element (see `components/VideoPlayer.vue`)
- **Audio Player**: HTML5 + MSE + Wake Lock (PWA) / react-native-track-player (Mobile)
- **API**: REST endpoints defined in `backend/main.py`; both frontends call through an API proxy (`api.js`) that delegates to the active provider
- **Downloads**: Handled via yt-dlp in `backend/services/ytdlp.py`
- **Provider Pattern**: `DataProvider` defines an abstract interface. `ServerProvider` makes HTTP calls to the Python backend. `LocalProvider` uses IndexedDB (PWA) or SQLite (Mobile) for fully offline operation.
- **Mode Switching**: Stores `localMode` flag. `providers/index.js/ts` detects the mode and builds the correct provider. All pages use the API proxy and never reference providers directly.
- **`.ht` files**: Zip archives containing `metadata.json` (serialized DB tables) and subdirectories `videos/` and `music/` with media files. The bridge between server mode and local mode.

## API Endpoints

### General
- `GET /api/status` - Health check / server status
- `GET /api/settings` - List server settings as key/value map
- `PUT /api/settings` - Set a server setting (body: key, value)
- `GET /api/downloads` - List background download jobs for active user: `[{id, type, item_id, user_id, status, progress, message, filename, error, created_at}]`. `status`: queued/running/done/error
- `GET /api/users` - List all users
- `POST /api/users` - Create user (body: name, image)

### Auth
- `POST /api/auth/exchange` - Exchange token for backend auth

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

- **One library, one data dir**: all paths (DB, downloads, file serving) are resolved by `backend/paths.py` from `data_dir` in `~/.config/hometube/config.json` (see `ht init`); `ht serve`, `ht download`/`ht` CLI commands, `main.py`, `ytdlp.py`, `import_music.py`, and `scheduler.py` all share the same data dir by default. `DB_PATH`/`DATA_DIR`/`DL_DIR` env vars override it.
- Backend serves the built frontend from `frontend/dist/`
- Scheduler runs in background checking subscriptions every 60 seconds
- **Background downloads**: server-side downloads run on a thread pool (`backend/services/downloader.py`, 2 workers) using `yt_dlp`'s Python API with progress hook → job registry. API endpoints return `202 {job_id}`; clients poll `GET /api/downloads` (status + 0-100 progress) via `frontend/src/utils/downloads.js` / `mobile/src/downloads.ts` (`waitForServerDownload`). Completed jobs write `filename`/`downloaded` back to the DB row. The lazy `/videos/{id}/file` and `/music/{id}/file` paths single-flight off an existing job (wait for it) instead of starting a duplicate download
- **Pre-download on add**: the `auto_download` server setting (default on) makes add endpoints queue a background download for every added video/music/podcast (`add_video`, `add_music`), so items are usually ready to play instantly. The scheduler also pre-warms newly-detected subscription items, and podcast feed backfill pre-warms only the newest 3 episodes (avoiding mass downloads on subscribe). Turn off with `ht settings set auto_download off` or `PUT /api/settings` `{key:"auto_download", value:"off"}` — lazy on-play downloads remain as fallback
- Auto-delete: Videos watched >7 days ago without keep_flag are deleted
- PWA support via `vite-plugin-pwa`
- Audio mode uses Wake Lock API to allow screen-off listening
- PWA download uses Web Downloads API to save files to device
- Music downloads preserve original format (mp3, webm, m4a, ogg, flac, wav) via yt-dlp
- Import script (`import_music.py`) supports mp3, webm, flac, wav, m4a, ogg formats
- MusicHome.vue: "My Songs" and "All Songs" appear as clickable virtual playlists
- PlaylistView.vue UI:
  - Displays first song's album art at top
  - Shows current song title/artist when playing
  - Playback controls row (prev/play-pause/next) appears when a song is playing
  - Play and Shuffle buttons always visible
  - Shuffle and Repeat toggle buttons
  - Clickable song list to select and play tracks
- State Persistence (localStorage):
  - App state: active tab, sub-pages, selected playlist ID
  - Virtual playlist view ("My Songs"/"All Songs") persisted
  - Per-playlist shuffle state (key: `playlist_{id}_shuffled`)
  - Video player state (key: `videoPlayerState`): queue ids, index, shuffle/repeat, position; restored on reload
  - State restores automatically on page refresh
- **Video experience**: equals the music/podcast model
  - Videos carry `thumbnail`, `duration`, `filename`, and `position` (resume point, seconds) alongside `watched_at` (binomial watched flag). Auto-watch at ~95% / ended
  - `kind:"video"` playlists (generalized Playlist model). Membership JSON: `{music_id, position}` for music, `{video_id, position, type:"video"}` for video
  - Watch API semantic: `POST /api/videos/{id}/watch` with `{watched:true}` marks watched; `{position}` only persists resume position (bare POST is a no-op)
  - PWA: single persistent `<video>` element in `VideoPlayer.vue` (always mounted in App.vue so playback survives navigation); queue/shuffle/repeat in `stores/video.js`; `VideoHome.vue` (Playlists/Feed segments) + `VideoPlaylistView.vue`; lazy play via `GET /api/videos/{id}/file` (auto-downloads on first play)
  - Mobile: feed thumbnails + resume badges + keep filter, player resumes from `position` and flushes progress (30s), auto-watches on `playToEnd`, and video playlists screens (`app/(tabs)/videos/playlists.tsx`, `playlist/[id].tsx`). Local-mode resolution fixed in `LocalProvider.getVideoUrl` (uses `video_{video_id}` file keys)
  - Offline: PWA caches `/api/videos` metadata; device cache/download flags marked on the video row

### Server Mode vs Local Mode

The frontend can operate in two modes:

- **Server Mode** (default): Connects to the Python FastAPI backend via HTTP. Uses `ServerProvider` which makes REST calls to the backend URL stored in `localStorage` (`backendUrl`). Supports ServiceWorker caching for offline-capable music/playlist access.

- **Local Mode**: Runs entirely offline. PWA uses IndexedDB (`hometube-local`), mobile app uses SQLite (`hometube-local.db`). Both use the same provider pattern with stores for: users, channels, subscriptions, videos, music, playlists, settings, files, meta. Media files stored as blobs (IndexedDB/PWA) or filesystem files (SQLite/mobile).

Users choose the mode on the `SetupBackend.vue` page on first launch. Mode can be toggled later in `SettingsPage.vue`. Data from `.ht` files can be imported in either mode.

### `.ht` File Format

`.ht` files are zip archives used to transfer HomeTube data between instances and between modes. Structure inside the zip:

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

Export sources:
- `POST /api/export` endpoint (server mode API)
- `python cli.py export` (terminal CLI, works directly on SQLite DB)
- Frontend export in local mode (packs IndexedDB data)

Import targets:
- `POST /api/import` endpoint (server mode API)
- `python cli.py import <file.ht>` (terminal CLI, writes to SQLite DB)
- Frontend import in local mode (populates IndexedDB)
- Mobile app import in local mode (populates SQLite)

- No test framework is currently configured
