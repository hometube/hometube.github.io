# HomeTube Mobile (React Native / Expo)

A React Native companion app for HomeTube using Expo SDK 56. Talks to the Bun server (`server/`) in server mode.

## Development

```bash
cd mobile
npm start                   # Start Expo dev server
npm run android             # Start on Android
npm run ios                 # Start on iOS
npm run web                 # Start on web
```

## Project Structure

```
mobile/
├── app/                          # Expo Router file-based routing
│   ├── _layout.tsx               # Root layout (providers, TrackPlayer init)
│   ├── index.tsx                 # Entry → redirect to welcome or tabs
│   ├── welcome/
│   │   ├── setup-backend.tsx     # Server/local mode choice
│   │   └── setup-user.tsx        # User selection/creation
│   └── (tabs)/
│       ├── _layout.tsx           # Root stack navigator (nav via mode switcher + settings gear)
│       ├── videos/               # Feed, add, channel, player, playlists
│       │   ├── index.tsx         # Video feed: filter chips, thumbnails, resume/watched badges
│       │   ├── add.tsx           # Add video by URL
│       │   ├── channel.tsx       # Browse channel videos / subscribe
│       │   ├── [id].tsx          # Player: expo-video, resume + 30s flush, auto-watch
│       │   ├── playlists.tsx     # Video playlist list / create / add-video prompt
│       │   └── playlist/[id].tsx # Playlist detail: play-all, reorder, rename, remove
│       ├── music/                # Music home, add, playlist, now-playing
│       └── settings/            # Settings, backend URL, export, import
├── src/
│   ├── providers/
│   │   ├── DataProvider.ts       # Abstract provider interface
│   │   ├── ServerProvider.ts     # HTTP provider (talks to Bun server)
│   │   ├── LocalProvider.ts      # SQLite provider (offline mode)
│   │   └── index.ts             # Provider factory (detect mode, build)
│   ├── downloads.ts              # waitForServerDownload(): polls GET /api/downloads until a job finishes
│   ├── stores/
│   │   ├── userStore.ts          # User state (Zustand)
│   │   ├── musicStore.ts         # Music playback (react-native-track-player)
│   │   ├── videoStore.ts         # Video state: queue/shuffle via feed, keep/watch, video playlists, downloads
│   │   ├── downloadStore.ts      # Server-mode "ensure downloaded" + offline cache batching
│   │   └── modeStore.ts          # Current mode (music/video/podcast) + switch modal
│   ├── db/
│   │   └── localDb.ts           # SQLite wrapper (9 tables mirroring the server schema)
│   ├── services/
│   │   ├── trackPlayerService.ts # Background audio service
│   │   └── playerSetup.ts       # TrackPlayer registration
│   ├── components/
│   │   ├── ModeButton.tsx       # Top-left mode icon (opens mode switcher)
│   │   ├── ModeSwitchModal.tsx  # Modal to switch between music/video/podcast
│   │   ├── SettingsButton.tsx   # Top-right gear → settings
│   │   ├── ModeTracker.tsx      # Syncs current mode with active route
│   │   ├── StatusToast.tsx      # Top toast when connection status changes
│   │   ├── StatusDot.tsx        # Green/gray dot (server mode) on settings icon and in settings
│   │   ├── LoadingSpinner.tsx
│   │   ├── EmptyState.tsx
│   │   └── index.ts            # Component re-exports
│   ├── api.ts                   # Provider proxy
│   └── types.ts                 # Shared TypeScript interfaces
├── app.json                     # Expo config (plugins, permissions, splash)
├── babel.config.js              # Babel config with module-resolver for @/ alias
└── tsconfig.json                # TypeScript config with path aliases
```

## Architecture

All screens go through the provider proxy:

```
Component → api.ts (Proxy) → Provider Factory
                             ├── ServerProvider (fetch → Bun server)
                             └── LocalProvider  (SQLite + expo-file-system)
```

- **Server Mode**: Makes HTTP requests to the Bun server. Same REST API.
- **Local Mode**: Uses SQLite via `expo-sqlite` for structured data and `expo-file-system` for media files.
- **`.ht` files**: Portable archive (zip with `metadata.json` + media files), shared with the server's export/import.

## Video Experience (mirrors music/podcasts)

- `Video` rows carry `position` (resume seconds), `duration`, `thumbnail`, `filename`, `watched_at` (binomial watched flag) and `keep_flag`.
- **Watch API semantic**: `POST /api/videos/{id}/watch` with `{watched:true}` marks watched; `{position}` only persists resume position. Player flushes progress every 30s + on unmount, and auto-marks watched on `playToEnd` (≥95%).
- **Video playlists**: `kind:"video"` playlists. Membership JSON is `{music_id, position}` for music vs `{video_id, position, type:"video"}` for video — never assume `music_id` is present.
- **Server-side downloads are async**: `POST .../download` returns `202 {job_id}`; poll via `src/downloads.ts` `waitForServerDownload(type, itemId)` (recommended) or raw `GET /api/downloads`. `videoStore.downloadVideo` tracks `downloadingIds` for feed spinners.
- **File resolution is async**: `getVideoUrl(video)`/`getMusicUrl(song)` return `string | null`. Media elements must handle null (e.g. "file not available, download first").
- **Local mode**: `LocalProvider` resolves media to real filesystem URIs (`video_<video_id>` keys for videos, song-id/file-name keys for music). Deleting a video purges it from video playlists and removes its files. `.ht` import remaps both `music_id` and `video_id` playlist members.
- **Expo Router typed routes**: `.expo/types/router.d.ts` is generated by `expo start`. If `router.push` rejects a new route in `tsc`, the file is stale — delete `.expo/types/router.d.ts` and re-run `npx tsc --noEmit` (it regenerates on next dev run).

## Key Libraries

| Library | Purpose |
|---------|---------|
| `expo-router` | File-based routing |
| `expo-sqlite` | Local mode database |
| `expo-file-system` | File storage for media blobs |
| `expo-video` | Video playback |
| `react-native-track-player` | Background audio playback |
| `expo-secure-store` | Token/settings storage |
| `expo-document-picker` | .ht file import |
| `expo-sharing` | .ht file export sharing |
| `zustand` | State management |
| `@expo/vector-icons` | Icons |
| `fflate` | Zip handling for .ht files |

## Background Audio

`react-native-track-player` runs as a native service: playback continues
reliably with the screen off, the app in background, and while the OS manages
resources.

## Import Conventions

Use `@/` path alias for all src imports:
```ts
import { API } from "@/api";
import { useUserStore } from "@/stores/userStore";
```

## Development Commands

```bash
npm start           # Start Expo dev server
npm run android     # Launch on Android
npm run ios         # Launch on iOS
npx tsc --noEmit    # TypeScript check
npx expo build:android  # EAS Build for Android
npx expo build:ios      # EAS Build for iOS
```
