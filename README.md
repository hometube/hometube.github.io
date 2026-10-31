# HomeTube

A self-hosted YouTube media downloader with desktop and mobile apps. Download videos and music from YouTube, subscribe to channels and podcasts, and automatically detect new uploads. Runs on your own hardware — a single Bun server plus a desktop app, an Android app, and a full CLI.

## Features

- **Video Downloads** - Paste YouTube URLs to download MP4 files with selectable quality (1080p/720p/480p/best)
- **Music Downloads** - Extract audio from videos/playlists, organize into playlists, resume playback where you left off
- **Podcasts** - Subscribe to podcast feeds; new episodes are detected and pre-downloaded automatically
- **Import Existing Music** - Import songs from local folders with automatic metadata extraction
- **Channel Subscriptions** - Subscribe to channels and auto-detect new videos with keyword/length/quality filters
- **Background Downloads** - Server-side download queue with live progress; pre-downloads on add by default
- **Smart Feed** - Video feed sorted by recency, filter by "My Feed" / "All Videos" / "Unwatched"
- **Watch Tracking** - Videos auto-marked as watched, with "Keep" flag to prevent auto-delete
- **Auto-Cleanup** - Watched videos automatically deleted after 7 days (unless kept)
- **Playlist Management** - Create music and video playlists, shuffle/repeat playback
- **Multi-User Support** - Multiple users with separate collections
- **LAN Pairing** - Connect devices over your LAN with one-time pairing tokens (QR on desktop, `ht pair` in the terminal)
- **Portable Data (.ht)** - Export/import your entire collection as `.ht` archive files to move between instances
- **CLI Tool** - Full terminal interface with `ht`: download, export/import, manage songs/playlists/videos, serve

## Apps

| App | What it is | Get it |
|-----|-----------|--------|
| **Desktop** | All-in-one Tauri app: bundled Bun server + UI, log viewer, QR pairing | [GitHub Releases](https://github.com/hometube/hometube.github.io/releases/latest) |
| **Mobile** | Android app (Expo/React Native) with offline mode, pairs via QR or token | [GitHub Releases](https://github.com/hometube/hometube.github.io/releases?q=mobile&expanded=true) |
| **Server + CLI** | Headless Bun server, systemd-friendly, driven by the `ht` command | `bash install.sh` (below) |

## Quick Start (Server + CLI)

```bash
git clone https://github.com/hometube/hometube.github.io hometube
cd hometube
bash install.sh          # installs bun if needed, server deps, and the ht command

ht init                  # configure data directory and default user
ht serve                 # http://localhost:8000, reachable on your LAN
ht pair                  # mint a one-time token to connect a device
```

Windows is experimental: `powershell -ExecutionPolicy Bypass -File install.ps1`.

### Prerequisites

- **Bun** — installed automatically by `install.sh` / `install.ps1`
- **yt-dlp** — the download engine (`brew install yt-dlp` / `winget install yt-dlp.yt-dlp`)
- **ffmpeg** — music conversion and cover-art embedding (`brew install ffmpeg`)
- **A JS runtime for yt-dlp** — newer YouTube formats need one (Deno recommended)

### Development Mode

```bash
cd server
bun install
bun run src/index.ts     # server on :8000
bunx tsc --noEmit        # typecheck
./parity.sh              # response-level regression checks (offline mode)
```

Desktop development (spawns the server from the repo automatically):

```bash
cd desktop
npm install
npm run tauri dev
```

### Environment Variables

- `DATA_DIR` - data directory (default: `data_dir` in `~/.config/hometube/config.json`, else `./data`)
- `DB_PATH` - SQLite database path (default: `$DATA_DIR/db.sqlite`)
- `DL_DIR` - download directory (default: `$DATA_DIR/downloads`)
- `PORT` - server port (default: 8000)

## CLI Tool (`ht`)

```bash
ht init                         # Interactive: data dir, default user
ht login <username>             # Switch active user (creates if not exists)

ht download "https://youtube.com/watch?v=..."                   # Single video
ht download "https://youtube.com/watch?v=..." --type music      # Force music
ht download "https://youtube.com/playlist?list=..." -p "Chill"  # Music playlist

ht songs / ht playlists / ht videos / ht podcasts               # Browse library
ht videos watched <id|name>     # Mark watched (--unwatch to clear)
ht videos keep <id|name>        # Prevent auto-delete (--unkeep to clear)

ht export -o backup.ht          # Export all data for active user
ht export --week -o week.ht     # Last 7 days only
ht import backup.ht             # Import .ht file
ht import --music ~/Music -p "Favorites" --move                 # Local folder import

ht settings get / set <key> <value>   # Server settings (e.g. auto_download)
ht serve [--host H] [--port P]        # Start the server
ht pair [--port P] [--ttl S]          # One-time pairing token for a device
```

## `.ht` Files

`.ht` files are zip archives used to move data between instances and into app
offline modes:

```
file.ht
├── metadata.json   # version, users, channels, subscriptions, videos, music, playlists, settings
├── videos/         # downloaded video files
└── music/          # downloaded music files
```

## Project Structure

```
hometube/
├── install.sh / install.ps1   # One-shot install: bun, deps, ht command
├── server/                    # Bun + Hono server (the whole backend)
│   ├── src/
│   │   ├── index.ts           # Entry: schema, JWT secret, boot token, listen
│   │   ├── app.ts             # Hono factory + auth middleware (LAN pairing JWTs)
│   │   ├── db.ts              # bun:sqlite, byte-identical schema to the old Python backend
│   │   ├── cli.ts             # The `ht` command
│   │   ├── hts.ts             # Shared .ht import core
│   │   ├── routes/            # core, library, media, podcasts, files, export
│   │   └── services/          # ytdlp (CLI spawn), downloader (job queue), scheduler
│   └── parity.sh              # Response-level regression harness
├── desktop/                   # Tauri v2 desktop app (server sidecar + Vue UI)
├── mobile/                    # React Native companion app (Expo SDK 56)
├── docs/                      # GitHub Pages site (documentation-only)
└── .github/workflows/         # Pages deploy, desktop builds, mobile builds
```

## Running as a systemd service (Linux)

```ini
# /etc/systemd/system/hometube.service
[Unit]
Description=HomeTube server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=hometube
WorkingDirectory=/opt/hometube/server
ExecStart=/usr/local/bin/bun run src/index.ts
Restart=on-failure
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
```

One unit = the full server (scheduler + download queue run as in-process
tasks; don't run two instances against one data dir). Tail with
`journalctl -u hometube -f`, health-check with `curl -s localhost:8000/api/status`.

Remote access beyond the LAN is out of scope: use a user-side reverse proxy or Tailscale.
