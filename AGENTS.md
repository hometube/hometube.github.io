# AGENTS.md

Instructions for AI agents working on the HomeTube project.

## Project Structure

```
hometube/
├── install.sh                # One-shot install: venv, deps, frontend build, ht command
├── .github/workflows/
│   └── deploy.yml            # GitHub Actions deploy workflow
├── backend/
│   ├── main.py               # FastAPI app with REST endpoints
│   ├── models.py             # DB models (User, Video, Music, Channel, Subscription, Playlist)
│   ├── database.py           # SQLite configuration
│   ├── cli.py                # CLI: install, init, login, download, export/import, songs, playlists, videos
│   ├── cli.sh                # Helper script: manages venv and installs ht command
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
│   │       ├── _layout.tsx          # Bottom tab navigator
│   │       ├── videos/              # Video feed, add, channel, player
│   │       ├── music/               # Music home, add, playlist, now-playing
│   │       └── settings/            # Settings, export, import
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
```

### Frontend (Vue PWA)
```bash
cd frontend
npm install
npm run dev        # Dev server
npm run build      # Production build
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
- **Video Player**: Plyr.js (PWA) / expo-video (Mobile)
- **Audio Player**: HTML5 + MSE + Wake Lock (PWA) / react-native-track-player (Mobile)
- **API**: REST endpoints defined in `backend/main.py`; both frontends call through an API proxy (`api.js`) that delegates to the active provider
- **Downloads**: Handled via yt-dlp in `backend/services/ytdlp.py`
- **Provider Pattern**: `DataProvider` defines an abstract interface. `ServerProvider` makes HTTP calls to the Python backend. `LocalProvider` uses IndexedDB (PWA) or SQLite (Mobile) for fully offline operation.
- **Mode Switching**: Stores `localMode` flag. `providers/index.js/ts` detects the mode and builds the correct provider. All pages use the API proxy and never reference providers directly.
- **`.ht` files**: Zip archives containing `metadata.json` (serialized DB tables) and subdirectories `videos/` and `music/` with media files. The bridge between server mode and local mode.

## API Endpoints

### General
- `GET /api/status` - Health check / server status
- `GET /api/downloads` - List download status for active user
- `GET /api/users` - List all users
- `POST /api/users` - Create user (body: name, image)

### Auth
- `POST /api/auth/exchange` - Exchange token for backend auth

### Videos
- `GET /api/videos?user_id=&filter=` - List videos (filter: all/my-feed/unwatched)
- `POST /api/videos/add` - Add video (body: url, user_id, quality)
- `GET /api/videos/info?url=` - Get available formats for URL
- `GET /api/videos/{id}/qualities` - Get available qualities for a video
- `POST /api/videos/{id}/watch` - Mark as watched
- `POST /api/videos/{id}/keep` - Toggle keep flag
- `POST /api/videos/{id}/download` - Download video
- `PUT /api/videos/{id}` - Update video metadata
- `DELETE /api/videos/{id}` - Delete video

### Music
- `GET /api/music?user_id=` - List music
- `POST /api/music/add` - Add music (body: url, user_id, playlist_id)
- `GET /api/music/info?url=` - Get music info
- `POST /api/music/{id}/download` - Download music (returns filename)
- `GET /api/music/{id}/file` - Serve music file with correct MIME type
- `PUT /api/music/{id}` - Update music metadata
- `DELETE /api/music/{id}` - Delete music

### Serving Files
- `GET /api/files/videos/{filename}` - Serve video files (video/mp4)
- `GET /api/files/music/{filename}` - Serve music files (auto-detects MIME: mp3, webm, m4a, ogg, flac, wav)

### Playlists
- `GET /api/playlists?user_id=` - List playlists
- `POST /api/playlists` - Create playlist
- `PUT /api/playlists/{id}` - Update playlist
- `POST /api/playlists/{id}/add` - Add song to playlist
- `DELETE /api/playlists/{id}/remove/{song_id}` - Remove song from playlist
- `DELETE /api/playlists/{id}` - Delete playlist

### Channels
- `POST /api/channels/add` - Add channel
- `GET /api/channels/{id}/videos` - Get channel videos
- `POST /api/channels/{id}/subscribe` - Subscribe with criteria
- `DELETE /api/subscriptions/{id}` - Unsubscribe

### Export / Import
- `POST /api/export` - Export database as .ht file (body: type, user_id, date_from, date_to, video_ids, music_ids)
- `POST /api/import` - Import .ht file into database (multipart file upload)

## Notes

- Backend serves the built frontend from `frontend/dist/`
- Scheduler runs in background checking subscriptions every 60 seconds
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
  - State restores automatically on page refresh

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
