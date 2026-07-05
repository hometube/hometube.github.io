# HomeTube

A self-hosted YouTube media downloader with a mobile-friendly web interface. Download videos and music from YouTube for offline viewing/listening, subscribe to channels, and automatically detect new uploads. Works in **server mode** (Python backend with SQLite) or **local mode** (fully offline in the browser via IndexedDB).

## Features

- **Video Downloads** - Paste YouTube URLs to download MP4 files with selectable quality (1080p/720p/480p/best)
- **Music Downloads** - Extract audio from videos/playlists, preserve original format (mp3, webm, m4a, ogg, flac, wav), organize into playlists
- **Import Existing Music** - Import songs from existing folders with automatic metadata extraction
- **Mobile Companion App** - React Native / Expo app for iOS and Android with full offline support
- **Channel Subscriptions** - Subscribe to channels and auto-detect new videos with keyword/length/quality filters
- **Video Player** - In-app player with speed control (0.5x-2x), audio mode (screen-off listening), fullscreen
- **Smart Feed** - Video feed sorted by recency, filter by "My Feed" / "All Videos" / "Unwatched"
- **Watch Tracking** - Videos auto-marked as watched, with "Keep" flag to prevent auto-delete
- **Auto-Cleanup** - Watched videos automatically deleted after 7 days (unless kept)
- **Playlist Management** - Create playlists, add songs, shuffle/repeat playback
- **Multi-User Support** - Multiple users with separate collections
- **Server Mode** - Connect to a Python/FastAPI backend with SQLite storage, yt-dlp downloads, background scheduler
- **Local Mode** - Fully offline operation in the browser via IndexedDB, no server needed
- **Portable Data (.ht)** - Export/import your entire collection as `.ht` archive files to move between modes and instances
- **CLI Tool** - Full terminal interface with `ht` command: download, export/import, manage songs/playlists/videos
- **Progressive Web App** - Mobile-optimized, installable on phones, download files to device
- **Automatic Scheduling** - Background service checks subscriptions every 60 seconds

## Tech Stack

- **Backend**: Python, FastAPI, SQLAlchemy, SQLite
- **Frontend (PWA)**: Vue 3, Vite, Tailwind CSS, Plyr.js, Pinia
- **Mobile App**: React Native, Expo SDK 56, TypeScript, expo-router, Zustand
- **Icons**: Font Awesome (PWA) / @expo/vector-icons (Mobile)
- **Audio**: HTML5 + MSE + Wake Lock (PWA) / react-native-track-player (Mobile)
- **Downloads**: yt-dlp

## Setup

### Prerequisites

- Python 3 with pip
- Node.js with npm

### Quick Start (Local Mode)

The easiest way to use HomeTube is to run the CLI and then import from the created exports into the frontend.
This allows for the app to be a PWA on any device without also requiring `ngrok` or setting up your own HTTPS / hosting.

```bash
# Install everything (venv, deps, frontend build, ht command)
bash install.sh

# Configure your data directory and default user
ht init

# Download some music
ht download "https://www.youtube.com/playlist?list=..." --playlist "Chill Vibes"

# Export for importing into the PWA
ht export -o my-collection.ht
```

Then open the frontend, choose **Local Mode**, and import the `.ht` file.

### Quick Start (Self Hosted)

```bash
# One-shot install (venv + deps + frontend build + ht command)
bash install.sh

# Start the server
cd backend && source cli.sh && python main.py
```

Open `http://localhost:8000` in your browser.

### Development Mode

#### Option 1: Standard Development (Hot Reload)
Run both servers in separate terminals:

```bash
# Terminal 1: Backend (with auto-reload)
cd backend && source cli.sh
uvicorn main:app --reload
# Runs on http://localhost:8000

# Terminal 2: Frontend (with hot reload)
cd frontend
npm install
npm run dev
# Runs on http://localhost:5173
```

#### Option 2: Development with Public URL (for GitHub Pages testing)
This mode automatically sets up an ngrok tunnel to expose your local backend securely:

```bash
# Terminal: Backend with ngrok tunnel
cd backend && source cli.sh
python main.py --dev
# This will show you a public URL to use with your GitHub Pages frontend
```

When running with `--dev`, the backend will:
1. Automatically start an ngrok tunnel to your local port
2. Display a secure public URL with an embedded token
3. You can use this URL directly in your GitHub Pages frontend
4. The token provides basic protection against unauthorized access

Example output:
```
============================================================
🚀 HomeTube Development Server Ready!
============================================================
Local API:     http://localhost:8000
Public URL:    https://abc123.ngrok.io
For github.io: https://abc123.ngrok.io/api?token=your-secret-token-here
============================================================
Share the 'For github.io' URL with your frontend to enable
secure access to your local backend via GitHub Pages.
============================================================
```

### Environment Variables

- `DB_PATH` - SQLite database path (default: `data/db.sqlite`)
- `DL_DIR` - Download directory (default: `data/downloads`)

## Usage

1. Open the web interface and create/select a user
2. **Video Home**: View your feed, filter videos, tap to play with built-in player
3. **Add Video**: Paste YouTube URL, select quality, download to server and device
4. **Add Channel**: Browse channel videos or subscribe with auto-download rules
5. **Music Home**: View playlists ("My Songs" / "All Songs"), create new playlists
6. **Add Music**: Paste song/playlist URL, add to playlist, download to device
7. **Playlist View**: Full player with album art, shuffle/repeat, song queue management

### Server Mode vs Local Mode

- **Server Mode** (default): Connect to a Python backend. Enter the backend URL on setup or paste one shared via `--dev` mode. All data is stored in SQLite on the server. Media downloads use yt-dlp.
- **Local Mode**: Runs entirely in your browser using IndexedDB — no server needed. Import an `.ht` file on setup to populate your local collection. Media and metadata are stored client-side. Switch modes in Settings at any time.

### CLI Tool (`ht`)

The `ht` command provides a full terminal interface for HomeTube:

```bash
# Install the command (done by install.sh, or manually:)
cd backend && bash cli.sh install

# Initialize configuration
ht init                         # Interactive: data dir, default user, mode

# User management
ht login <username>             # Switch active user (creates if not exists)
ht login <username> --yes       # Create without prompting

# Downloads (auto-detects video vs music vs playlist)
ht download "https://youtube.com/watch?v=..."                   # Single video
ht download "https://youtube.com/watch?v=..." --type music      # Force music
ht download "https://youtube.com/playlist?list=..."             # Auto playlist
ht download "https://youtube.com/playlist?list=..." -p "Chill"  # Music + playlist

# Browse your library
ht songs                        # List music for active user
ht playlists                    # List playlists for active user
ht videos                       # List videos for active user

# Export / Import
ht export -o backup.ht          # Export all data for active user
ht export --week -o week.ht     # Last 7 days only
ht export --month -o month.ht   # Last 30 days only
ht export --day -o day.ht       # Last 24 hours only
ht import backup.ht             # Import .ht file
ht import --music ~/Music       # Import music files from folder
ht import --music ~/Music -p "Favorites" --move  # Import + playlist + move
```

Data can also be transferred via the frontend UI in both modes.

### Import Existing Music Collection

Import songs from an existing folder into HomeTube with automatic metadata extraction:

```bash
cd backend && source cli.sh

# List users to get your user ID
python import_music.py --list-users

# (Optional) List playlists
python import_music.py --list-playlists --user-id 1

# Import music files (copies by default)
python import_music.py --folder /path/to/your/music --user-id 1

# Import and add to a specific playlist
python import_music.py --folder /path/to/your/music --user-id 1 --playlist-id 1

# Move files instead of copying
python import_music.py --folder /path/to/your/music --user-id 1 --move
```

Supports: MP3, FLAC, WAV, M4A, AAC, OGG. Extracts title, artist, and album from file metadata.

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
│   ├── import_music.py       # Import existing music files
│   ├── requirements.txt      # Python dependencies
│   └── services/
│       ├── ytdlp.py          # yt-dlp wrapper for downloads
│       └── scheduler.py      # Background subscription checker + auto-delete
├── frontend/
│   ├── src/
│   │   ├── App.vue           # Main Vue app with slide-out nav menu
│   │   ├── api.js            # API proxy – delegates to active provider
│   │   ├── localDb.js        # IndexedDB wrapper (local mode storage)
│   │   ├── providers/
│   │   │   ├── DataProvider.js    # Abstract provider interface
│   │   │   ├── ServerProvider.js  # HTTP provider for server mode
│   │   │   ├── LocalProvider.js   # IndexedDB provider for local mode
│   │   │   └── index.js          # Provider factory (detect, build, switch)
│   │   ├── components/
│   │   │   ├── GlobalMusicPlayer.vue  # Persistent mini-player across the app
│   │   │   ├── WaveformVisual.vue     # Audio waveform visualization
│   │   │   ├── BackendMenu.vue        # Backend URL configuration modal
│   │   │   ├── PlaylistMenu.vue       # Playlist context menu
│   │   │   └── SongMenu.vue           # Song context menu
│   │   ├── pages/
│   │   │   ├── UserPage.vue           # User selection/creation
│   │   │   ├── SetupUser.vue          # User setup wizard
│   │   │   ├── SetupBackend.vue       # Initial mode selection
│   │   │   ├── VideoHome.vue          # Video feed + player (Plyr.js)
│   │   │   ├── AddVideo.vue           # Add video by URL
│   │   │   ├── AddChannel.vue         # Channel browser + subscribe
│   │   │   ├── MusicHome.vue          # Playlists + songs
│   │   │   ├── AddMusic.vue           # Add music by URL
│   │   │   ├── PlaylistView.vue       # Music player with queue
│   │   │   ├── ExportPage.vue         # Export .ht files
│   │   │   ├── ImportPage.vue         # Import .ht files
│   │   │   ├── SettingsPage.vue       # Mode toggle, settings
│   │   │   ├── DebugPage.vue          # Debug/info page
│   │   │   └── AboutPage.vue          # App info and version
│   │   ├── stores/                    # Pinia stores (music, video, user, errors)
│   │   └── style.css
│   ├── package.json
│   └── vite.config.js       # Vite + PWA config
├── mobile/                   # React Native companion app (Expo SDK 56)
│   ├── app/                  # Expo Router file-based routing
│   ├── src/
│   │   ├── providers/        # DataProvider, ServerProvider, LocalProvider
│   │   ├── stores/           # Zustand stores (user, music, video, ui)
│   │   ├── db/localDb.ts     # SQLite wrapper
│   │   ├── services/         # TrackPlayer background audio
│   │   ├── components/       # Shared UI components
│   │   ├── api.ts            # Provider proxy
│   │   └── types.ts          # TypeScript interfaces
│   ├── app.json              # Expo config
│   ├── babel.config.js
│   └── tsconfig.json
└── data/
    ├── db.sqlite            # SQLite database
    └── downloads/           # Downloaded media files
```
