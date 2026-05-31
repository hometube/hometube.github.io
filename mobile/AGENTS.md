# HomeTube Mobile (React Native / Expo)

A React Native companion app for HomeTube using Expo SDK 56. Coexists with the Vue PWA (`frontend/`).

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
│       ├── _layout.tsx           # Bottom tab navigator
│       ├── videos/               # Video feed, add, channel, player
│       ├── music/                # Music home, add, playlist, now-playing
│       └── settings/             # Settings, export, import
├── src/
│   ├── providers/
│   │   ├── DataProvider.ts       # Abstract provider interface
│   │   ├── ServerProvider.ts     # HTTP provider (talks to FastAPI backend)
│   │   ├── LocalProvider.ts      # SQLite provider (offline mode)
│   │   └── index.ts             # Provider factory (detect mode, build)
│   ├── stores/
│   │   ├── userStore.ts          # User state (Zustand)
│   │   ├── musicStore.ts         # Music playback (react-native-track-player)
│   │   └── videoStore.ts         # Video state
│   ├── db/
│   │   └── localDb.ts           # SQLite wrapper (9 tables mirroring IndexedDB stores)
│   ├── services/
│   │   ├── trackPlayerService.ts # Background audio service
│   │   └── playerSetup.ts       # TrackPlayer registration
│   ├── components/
│   │   ├── LoadingSpinner.tsx
│   │   └── EmptyState.tsx
│   ├── api.ts                   # Provider proxy (same pattern as frontend)
│   └── types.ts                 # Shared TypeScript interfaces
├── app.json                     # Expo config (plugins, permissions, splash)
├── babel.config.js              # Babel config with module-resolver for @/ alias
└── tsconfig.json                # TypeScript config with path aliases
```

## Architecture

The provider pattern is identical to the Vue PWA:

```
Component → api.js (Proxy) → Provider Factory
                              ├── ServerProvider (fetch → FastAPI backend)
                              └── LocalProvider  (SQLite + expo-file-system)
```

- **Server Mode**: Makes HTTP requests to the Python FastAPI backend. Same REST API.
- **Local Mode**: Uses SQLite via `expo-sqlite` for structured data and `expo-file-system` for media files.
- **`.ht` files**: Same import/export format as the PWA (zip with `metadata.json` + media files).

## Key Libraries

| Library | Purpose |
|---------|---------|
| `expo-router` | File-based routing |
| `expo-sqlite` | Local mode database (replaces IndexedDB) |
| `expo-file-system` | File storage for media blobs |
| `expo-video` | Video playback |
| `react-native-track-player` | Background audio playback (solves the PWA screen-off issue) |
| `expo-secure-store` | Token/settings storage (replaces localStorage) |
| `expo-document-picker` | .ht file import |
| `expo-sharing` | .ht file export sharing |
| `zustand` | State management (replaces Pinia) |
| `@expo/vector-icons` | Icons (replaces Font Awesome) |
| `fflate` | Zip handling for .ht files |

## Background Audio

The critical fix: `react-native-track-player` runs as a native service. Playback continues reliably even when:
- Screen is off
- App is in background
- OS is managing resources

This replaces the PWA's unreliable `<audio>` + Wake Lock + Media Session approach.

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
