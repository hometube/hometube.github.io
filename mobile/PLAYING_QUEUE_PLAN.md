# Playing/Queue Feature — Execution Plan

Build a persistent **"Playing" queue** in the mobile app. The Playing queue is the canonical
ordered list of tracks the player will play through, and it can be populated from other
playlists via song-level and playlist-level actions. A new **Playing view** shows the live
queue and is reachable from the miniplayer.

**Scope:** mobile app only (`mobile/`). PWA unchanged. Codebase uses Expo SDK 56, TypeScript,
`react-native-track-player`, zustand.

---

## Current architecture (verified)

`src/stores/musicStore.ts` already models a queue and exposes:
- `queue: Music[]` — the live play order
- `originalOrder: Music[]` — pre-shuffle order of the queue's source
- `playlistId: string | null` — source playlist id (or `-1` All Songs / `-2` My Songs)
- `currentIndex`, `isPlaying`, `shuffle`, `repeat`
- `loadPlaylistSongs(songs, playlistId)` — **replaces** the queue with a playlist's songs
- `playSong(index)`, `playFirst()`, `shufflePlay()` — replace queue / play
- `next()`, `previous()`, `togglePlayPause()`, `toggleShuffle()`, `toggleRepeat()`, `seekTo()`
- `hasActiveQueue()`, `isInQueue(id)`
- `addToQueueNext(song)` — inserts a single song after current
- `addToQueue(song)` — appends a single song
- `removeFromQueue(songId)`
- `_loadQueueToPlayer(queue, index, position, shouldPlay)` — pushes tracks to TrackPlayer
  (note: now pings the server and filters out non-downloaded tracks when offline)
- `_rebuildQueueToPlayer()` — reloads the current store queue into TrackPlayer

**Pages:**
- `app/(tabs)/music/index.tsx` — playlist list (virtual "All Songs"/"My Songs" + real playlists)
- `app/(tabs)/music/playlist/[id].tsx` — playlist detail; has song menu bottom-sheet
  (`songMenuItems`, `handleSongAction`) and playlist menu bottom-sheet (`menuItems`)
- `app/(tabs)/music/_layout.tsx` — Stack; registers routes; renders `MiniPlayer`
- `src/components/MiniPlayer.tsx` — persistent miniplayer; tapping it calls
  `goToCurrentPlaylist()` which currently navigates to the source playlist

**Key fact:** `loadPlaylistSongs` REPLACES the queue. `addToQueue`/`addToQueueNext` append/insert.

---

## Target semantics (from the ask)

### Song menu (on any playlist) — these ADD to the Playing queue, do NOT navigate away
- **Play Now** — make this song the Playing queue and play it immediately.
- **Play Next** — insert immediately after the current track; don't change what's playing.
- **Add to Queue** — append to the end of the Playing queue; don't change what's playing.
- (keep) **Remove from Queue**, **Download**, **Remove from Playlist**.

Rules for song actions:
- Queue currently **empty** → each song action behaves as "start fresh": set
  `queue = [song]`, `currentIndex = 0`, `originalOrder = [song]`, and **play** it (for
  Play Now / Play Next / Add to Queue when nothing is playing, playing the first track is the
  expected "start" behavior). Stay on the active view (no navigation).
- Queue **non-empty**:
  - Play Now → `queue = [song]`, `originalOrder = [song]`, `currentIndex = 0`, play.
  - Play Next → insert at `currentIndex + 1`.
  - Add to Queue → append to end.
  - Stay on the active view (no navigation) in all cases.

### Playlist menu (on any playlist) — Play/Shuffle REPLACE the list; queue actions add
- **Play** — replace the Playing queue with this playlist (existing `loadPlaylistSongs` +
  `playFirst`).
- **Shuffle Play** — replace with shuffled playlist (existing `loadPlaylistSongs` +
  `shufflePlay`).
- **Add to Queue** — append this playlist's songs to the end of the Playing queue
  (shuffled only if that playlist's stored shuffle pref is "on"; otherwise in playlist order).
- **Shuffle and Add to Queue** — shuffle this playlist's songs and append to the end.
- (keep) **Download All**, **Delete Playlist**, **Manage**.
- (keep) the top **Play** / **Shuffle** buttons — they REPLACE the list.

Rules for playlist actions:
- Navigate to the **Playing view** (`/music/playing`) when the queue was **empty** before the
  action (so you can see what got queued/started). When a queue was already active, stay on the
  playlist.
  - `Add to Queue` with empty queue also **starts playing** the first added track (so the
    Playing view isn't left with an idle queue).
  - `Shuffle and Add to Queue` with empty queue starts playing the first (shuffled) track.

### Playing view (`/music/playing`)
- New route, registered in the Music `_layout.tsx` stack.
- Presents like a playlist: a list of songs from `queue`, current song highlighted, tap a song
  to `playSong(index)` from that point.
- **Instead** of the Play / Shuffle / ellipsis buttons a playlist has, it has a **repeat
  toggle** control (repeat on/off). No "Add to Queue" or "Play"/"Shuffle" here.
- Song row menu here only needs `Remove from Queue` (and optionally Download). Reuse the same
  song-row pattern as the playlist page.
- Empty state: prompt to add songs from a playlist.

### Miniplayer
- Tapping the miniplayer (currently `goToCurrentPlaylist`) should navigate to the Playing view
  (`/(tabs)/music/playing`), not the source playlist.

---

## Implementation steps

### 1. `src/stores/musicStore.ts` — add/extend actions

Add to the `PlaybackState` interface and implement:

- `playNow(song: Music): Promise<void>`
  ```ts
  playNow: async (song) => {
    const fresh = [{ ...song }];
    set({ queue: fresh, originalOrder: fresh, playlistId: null, shuffle: "off", currentIndex: 0 });
    await _loadQueueToPlayer(fresh, 0, 0, true);
    _cacheSongsBackground(fresh);
  }
  ```
- `playNext(song: Music): Promise<void>` — if `queue` empty → behave like `playNow`; else insert
  at `currentIndex + 1` (or `queue.length` if there's no current track), then `_rebuildQueueToPlayer()`
  without changing playback.
- Change `addToQueue` so that when the queue is empty it starts playing (`playNow` behavior);
  otherwise keep current append behavior.
- `addToQueueSongs(songs: Music[]): Promise<void>` — append a list. If queue empty → set
  `queue = list`, `currentIndex = 0`, play first, set `playlistId` to the source only if it was
  null/empty. Else append and `_rebuildQueueToPlayer()`.
- `shuffleAndAddToQueue(songs: Music[]): Promise<void>` — `fullShuffle(list)`, then same as
  `addToQueueSongs`.
- Add a derived helper (or reuse) for "queue is empty": `queue.length === 0 || currentIndex < 0`.

Decision notes for the implementer:
- Keep `playlistId` semantics: Play/Shuffle Play set `playlistId` (existing). Queue-append actions
  should NOT overwrite an existing `playlistId` (the queue is now mixed-source); only set
  `playlistId` when starting a fresh queue from an append (e.g. source playlist id).
- `originalOrder` for a mixed/queued queue: set to the full current `queue` when appending.

### 2. `app/(tabs)/music/playlist/[id].tsx` — song + playlist menus

- **Song menu** (`songMenuItems`): replace the current `Play` item with **Play Now**
  (`playNow(song)`). Keep **Play Next**, **Add to Queue**, **Remove from Queue**, **Download**,
  **Remove from Playlist**. Each song action in `handleSongAction` should call the new store
  methods. NO navigation after song actions.
- **Playlist menu** (`menuItems`): add **Add to Queue** (`addToQueueSongs(playableSongs)`) and
  **Shuffle and Add to Queue** (`shuffleAndAddToQueue(playableSongs)`). Keep **Play**,
  **Shuffle Play**, **Download All**, **Delete Playlist**, **Manage**.
- After any playlist-level action (Play / Shuffle Play / Add to Queue / Shuffle and Add to Queue),
  if the queue was empty before the action, `router.navigate("/(tabs)/music/playing")`.
  Capture `wasEmpty` via `useMusicStore.getState().queue.length === 0` before the action.
- Note: `playableSongs` is already computed and filters to offline songs in local mode.

### 3. New `app/(tabs)/music/playing.tsx`

- Register in `app/(tabs)/music/_layout.tsx`:
  `<Stack.Screen name="playing" options={{ title: "Playing" }} />`
- Read `queue`, `currentIndex`, `isPlaying`, `repeat`, `toggleRepeat`, `playSong`,
  `removeFromQueue`, plus `music` from `libraryStore` for album art/download state.
- Render:
  - Empty state when `queue.length === 0`: message like "Nothing playing — add songs from a
    playlist."
  - Song list (FlashList) mirroring the playlist page's `SongRow` (reuse the pattern; you can
    inline a simpler row): current song highlighted, tap → `playSong(index)`.
  - A **repeat toggle** control in place of Play/Shuffle/menu: `toggleRepeat()`, icon reflects
    `repeat` (e.g. `Ionicons name={repeat ? "repeat" : "repeat-outline"}`).
- Optional: a `Remove from Queue` action via long-press / ellipsis menu on a row
  (`removeFromQueue(song.id)`).

### 4. `src/components/MiniPlayer.tsx`

- Replace `goToCurrentPlaylist`/`goToCurrentPlaylist` navigation with:
  `router.navigate("/(tabs)/music/playing" as any)` (always navigate to the Playing view on tap).
- This removes the dependency on `playlistId`/`playlists` for navigation; keep unused imports
  cleaned up or leave `playlistId` in place if still used elsewhere (it's only used for the
  playlist name/query in that function — remove the now-unused `playlists`/`playlistName` code
  if nothing else uses them).

### 5. Verify

```bash
cd mobile && npx tsc --noEmit
```

---

## Files touched
- `src/stores/musicStore.ts` (add `playNow`, `playNext`, `addToQueueSongs`, `shuffleAndAddToQueue`;
  update `addToQueue` empty-queue behavior; extend interface)
- `app/(tabs)/music/playlist/[id].tsx` (song/playlist menus + empty-queue navigation)
- `app/(tabs)/music/playing.tsx` (new)
- `app/(tabs)/music/_layout.tsx` (register `playing` route)
- `src/components/MiniPlayer.tsx` (tap → Playing view)

## Out of scope
- PWA (`frontend/`)
- Server/CLI behavior
