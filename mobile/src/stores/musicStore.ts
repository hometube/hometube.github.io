import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import TrackPlayer, {
  State,
  Track,
  RepeatMode,
  Event,
} from "react-native-track-player";
import { API, getProvider } from "../api";
import { useUserStore } from "./userStore";
import { useLibraryStore } from "./libraryStore";
import { useConnectionStore } from "./connectionStore";
import type { Music, Playlist } from "../types";

type ShuffleMode = "off" | "on";

const STATE_KEY = "musicPlayerState";

export function cleanTitle(title?: string | null): string {
  if (!title) return title ?? "";
  return title.replace(/\s*\[[^\]]+\]\s*$/, "");
}

interface PlaybackState {
  queue: Music[];
  originalOrder: Music[];
  playlistId: string | null;
  currentIndex: number;
  isPlaying: boolean;
  shuffle: ShuffleMode;
  repeat: boolean;

  loadPlaylistSongs: (songs: Music[], playlistId: string | null) => Promise<void>;
  playSong: (index: number) => Promise<void>;
  playFirst: () => Promise<void>;
  shufflePlay: () => Promise<void>;
  togglePlayPause: () => Promise<void>;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  toggleShuffle: () => Promise<void>;
  toggleRepeat: () => Promise<void>;
  seekTo: (position: number) => Promise<void>;
  clearQueue: () => Promise<void>;

  hasActiveQueue: () => boolean;
  isInQueue: (songId: number) => boolean;
  addToQueueNext: (song: Music) => Promise<void>;
  addToQueue: (song: Music) => Promise<void>;
  removeFromQueue: (songId: number) => Promise<void>;
  playNow: (song: Music) => Promise<void>;
  playNext: (song: Music) => Promise<void>;
  addToQueueSongs: (songs: Music[]) => Promise<void>;
  shuffleAndAddToQueue: (songs: Music[]) => Promise<void>;

  markSongDownloaded: (songId: number) => void;
  markSongsDownloaded: (ids: number[]) => void;

  restorePlaybackState: () => Promise<boolean>;
  savePlaybackState: () => Promise<void>;
  clearPlaybackState: () => Promise<void>;
}

function shuffleKeepingIndex(list: Music[], keepIndex: number): Music[] {
  const rest = list.filter((_, i) => i !== keepIndex);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  rest.splice(keepIndex, 0, list[keepIndex]);
  return rest;
}

function fullShuffle(list: Music[]): Music[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function trackFor(song: Music, url?: string): Promise<Track> {
  const resolved = url || (await API.getMusicUrl(song));
  return {
    id: String(song.id),
    url: resolved,
    title: song.title || song.url,
    artist: song.artist || "Unknown",
    artwork: song.album_art || undefined,
  };
}

let _eventsRegistered = false;

export function setupMusicPlayback(): void {
  if (_eventsRegistered) return;
  _eventsRegistered = true;

  TrackPlayer.addEventListener(
    Event.PlaybackActiveTrackChanged,
    (payload: any) => {
      const idx = typeof payload.index === "number" ? payload.index : -1;
      if (idx < 0) return;
      useMusicStore.setState({ currentIndex: idx });
      useMusicStore.getState().savePlaybackState();
    }
  );

  TrackPlayer.addEventListener(Event.PlaybackState, (payload: any) => {
    useMusicStore.setState({ isPlaying: payload.state === State.Playing });
    scheduleSavePlaybackState();
  });

  if (!_playbackSaveTimer) {
    _playbackSaveTimer = setInterval(() => {
      if (useMusicStore.getState().isPlaying) {
        useMusicStore.getState().savePlaybackState();
      }
    }, 10000);
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSavePlaybackState() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    useMusicStore.getState().savePlaybackState();
  }, 1500);
}

let _playbackSaveTimer: ReturnType<typeof setInterval> | null = null;

export const useMusicStore = create<PlaybackState>((set, get) => {
  const _loadQueueToPlayer = async (
    queue: Music[],
    index: number,
    position = 0,
    shouldPlay = true
  ): Promise<number> => {
    const urls = await Promise.all(queue.map((song) => API.getMusicUrl(song)));
    const urlById = new Map<number, string>();
    queue.forEach((song, i) => urlById.set(song.id, urls[i]));

    const isRemote = (u: string) => /^https?:/i.test(u);
    const allLocal = urls.every((u) => !isRemote(u));

    let playable = queue;
    let activeIndex = index;

    if (!allLocal) {
      let reachable: boolean | null = null;
      const conn = useConnectionStore.getState().status;
      const known = (await getProvider()).isReachable();
      if (conn === "online") reachable = true;
      else if (conn === "offline" || known === false) reachable = false;
      if (reachable === null) {
        if (known === true) {
          reachable = true;
        } else {
          try {
            reachable = await API.ping();
          } catch {
            reachable = false;
          }
        }
      }

      if (!reachable) {
        playable = queue.filter((song) => !isRemote(urlById.get(song.id)!));
        if (playable.length === 0) {
          await TrackPlayer.reset();
          set({ queue: [], originalOrder: [], currentIndex: -1 });
          return -1;
        }
        if (playable.length !== queue.length) {
          const targetSong = queue[index];
          activeIndex = playable.findIndex(
            (s) => targetSong && s.id === targetSong.id
          );
          if (activeIndex < 0) activeIndex = 0;
          activeIndex = Math.min(activeIndex, playable.length - 1);
          set({
            queue: [...playable],
            originalOrder: [...playable],
            currentIndex: activeIndex,
            shuffle: get().shuffle,
          });
        }
      }
    }

    const tracks = await Promise.all(
      playable.map((song) => trackFor(song, urlById.get(song.id)!))
    );
    await TrackPlayer.reset();
    if (tracks.length > 0) {
      await TrackPlayer.add(tracks);
      const target = Math.min(Math.max(activeIndex, 0), tracks.length - 1);
      activeIndex = target;
      await TrackPlayer.skip(target, position);
    }
    if (shouldPlay) {
      await TrackPlayer.play();
    } else {
      await TrackPlayer.pause();
    }
    return activeIndex;
  };

  const _rebuildQueueToPlayer = async () => {
    const { queue, currentIndex, isPlaying } = get();
    if (queue.length === 0) {
      await TrackPlayer.reset();
      set({ currentIndex: -1 });
      return;
    }
    let position = 0;
    try {
      const progress = await TrackPlayer.getProgress();
      position = progress.position || 0;
    } catch {}
    let activeTrackId: number | null = null;
    try {
      const active = await TrackPlayer.getActiveTrack();
      if (active) activeTrackId = parseInt(String(active.id), 10);
    } catch {}
    let targetIndex = currentIndex;
    if (activeTrackId != null) {
      const idx = queue.findIndex((s) => s.id === activeTrackId);
      if (idx >= 0) targetIndex = idx;
    }
    await _loadQueueToPlayer(queue, targetIndex, position, isPlaying);
  };

  const _cacheSongsBackground = async (songs: Music[]) => {
    for (const song of songs) {
      try {
        const res = await API.cache(`/music/${song.id}/file`, {
          ttl: 0,
          refetch: false,
        });
        if (res) {
          get().markSongDownloaded(song.id);
          useLibraryStore.getState().setSongDownloaded(song.id);
        }
      } catch {}
    }
  };

  return {
    queue: [],
    originalOrder: [],
    playlistId: null,
    currentIndex: -1,
    isPlaying: false,
    shuffle: "off",
    repeat: false,

    loadPlaylistSongs: async (songs, playlistId) => {
      const state = get();
      const wasPlaying = state.isPlaying && state.currentIndex >= 0;
      const currentSongId = wasPlaying
        ? state.queue[state.currentIndex]?.id
        : null;

      let shuff: ShuffleMode = "off";
      if (playlistId) {
        const stored = await SecureStore.getItemAsync(`playlist_${playlistId}_shuffled`);
        if (stored !== null) shuff = stored === "true" ? "on" : "off";
      }

      let queue = [...songs];
      let index = 0;
      if (shuff === "on") {
        queue = shuffleKeepingIndex(songs, 0);
        index = queue.findIndex((s) => s.id === songs[0]?.id);
        if (index < 0) index = 0;
      }
      if (wasPlaying && currentSongId) {
        const newIndex = queue.findIndex((s) => s.id === currentSongId);
        if (newIndex >= 0) index = newIndex;
      }

      set({
        originalOrder: [...songs],
        queue,
        playlistId,
        shuffle: shuff,
        currentIndex: index,
      });
    },

    playSong: async (index) => {
      const state = get();
      const song = state.queue[index];
      if (!song) return;
      const target = await _loadQueueToPlayer(state.queue, index, 0, true);
      set({ currentIndex: target, isPlaying: true });
      if (target >= 0) {
        _cacheSongsBackground([state.queue[target] ?? song]);
      }
    },

    playFirst: async () => {
      const state = get();
      if (state.shuffle === "on") {
        const key = state.playlistId ? `playlist_${state.playlistId}_shuffled` : null;
        if (key) await SecureStore.setItemAsync(key, "false");
        set({ shuffle: "off", queue: [...state.originalOrder], currentIndex: 0 });
      }
      await get().playSong(0);
    },

    shufflePlay: async () => {
      const state = get();
      const source =
        state.originalOrder.length > 0 ? state.originalOrder : state.queue;
      const queue = fullShuffle(source);
      const key = state.playlistId
        ? `playlist_${state.playlistId}_shuffled`
        : null;
      if (key) await SecureStore.setItemAsync(key, "true");
      set({ shuffle: "on", queue, currentIndex: 0 });
      const first = queue[0];
      if (first) await get().playSong(0);
    },

    togglePlayPause: async () => {
      const state = await TrackPlayer.getPlaybackState();
      if (state.state === State.Playing) {
        await TrackPlayer.pause();
        set({ isPlaying: false });
      } else {
        await TrackPlayer.play();
        set({ isPlaying: true });
      }
    },

    next: async () => {
      await TrackPlayer.skipToNext();
      set({ isPlaying: true });
    },

    previous: async () => {
      const position = await TrackPlayer.getProgress();
      if (position.position > 3) {
        await TrackPlayer.seekTo(0);
      } else {
        await TrackPlayer.skipToPrevious();
      }
      set({ isPlaying: true });
    },

    toggleShuffle: async () => {
      const state = get();
      const next: ShuffleMode = state.shuffle === "on" ? "off" : "on";
      if (state.playlistId) {
        await SecureStore.setItemAsync(
          `playlist_${state.playlistId}_shuffled`,
          String(next === "on")
        );
      }

      let queue = state.queue;
      let index = state.currentIndex;

      if (next === "on") {
        queue = shuffleKeepingIndex(state.queue, state.currentIndex);
        index = queue.findIndex((s) => s.id === state.queue[state.currentIndex]?.id);
        if (index < 0) index = 0;
      } else {
        const curId = state.queue[state.currentIndex]?.id;
        queue = [...state.originalOrder];
        index = curId != null ? queue.findIndex((s) => s.id === curId) : state.currentIndex;
        if (index < 0) index = 0;
      }

      set({ shuffle: next, queue, currentIndex: index });
      await _rebuildQueueToPlayer();
    },

    toggleRepeat: async () => {
      const state = get();
      const newRepeat = !state.repeat;
      set({ repeat: newRepeat });
      await TrackPlayer.setRepeatMode(
        newRepeat ? RepeatMode.Queue : RepeatMode.Off
      );
      await SecureStore.setItemAsync("repeat", String(newRepeat));
    },

    seekTo: async (position) => {
      await TrackPlayer.seekTo(position);
    },

    clearQueue: async () => {
      await TrackPlayer.reset();
      set({
        queue: [],
        originalOrder: [],
        playlistId: null,
        currentIndex: -1,
        isPlaying: false,
        shuffle: "off",
      });
      await SecureStore.deleteItemAsync(STATE_KEY);
    },

    hasActiveQueue: () => get().queue.length > 0,

    isInQueue: (songId) => get().queue.some((s) => s.id === songId),

    addToQueueNext: async (song) => {
      const state = get();
      if (state.queue.length === 0 || state.currentIndex < 0) {
        await get().playNow(song);
        return;
      }
      const index = state.currentIndex + 1;
      const queue = [...state.queue];
      queue.splice(index, 0, { ...song });
      set({ queue, originalOrder: [...queue] });
      await _rebuildQueueToPlayer();
    },

    addToQueue: async (song) => {
      const state = get();
      if (state.queue.some((s) => s.id === song.id)) return;
      if (state.queue.length === 0 || state.currentIndex < 0) {
        await get().playNow(song);
        return;
      }
      const queue = [...state.queue, { ...song }];
      set({ queue, originalOrder: [...queue] });
      await _rebuildQueueToPlayer();
    },

    removeFromQueue: async (songId) => {
      const state = get();
      const queue = state.queue.filter((s) => s.id !== songId);
      set({ queue });
      await _rebuildQueueToPlayer();
    },

    playNow: async (song) => {
      const fresh = [{ ...song }];
      set({
        queue: fresh,
        originalOrder: fresh,
        playlistId: null,
        shuffle: "off",
        currentIndex: 0,
      });
      const target = await _loadQueueToPlayer(fresh, 0, 0, true);
      set({ currentIndex: target });
      if (target >= 0) _cacheSongsBackground(fresh);
    },

    playNext: async (song) => {
      const state = get();
      if (state.queue.length === 0 || state.currentIndex < 0) {
        await get().playNow(song);
        return;
      }
      const index = state.currentIndex + 1;
      const queue = [...state.queue];
      queue.splice(index, 0, { ...song });
      set({ queue, originalOrder: [...queue] });
      await _rebuildQueueToPlayer();
    },

    addToQueueSongs: async (songs) => {
      const state = get();
      const list = songs.map((s) => ({ ...s }));
      if (list.length === 0) return;
      if (state.queue.length === 0 || state.currentIndex < 0) {
        set({
          queue: list,
          originalOrder: [...list],
          playlistId: null,
          shuffle: "off",
          currentIndex: 0,
        });
        const target = await _loadQueueToPlayer(list, 0, 0, true);
        set({ currentIndex: target });
        _cacheSongsBackground(list);
        return;
      }
      const queue = [...state.queue, ...list];
      set({ queue, originalOrder: [...queue] });
      await _rebuildQueueToPlayer();
    },

    shuffleAndAddToQueue: async (songs) => {
      await get().addToQueueSongs(fullShuffle(songs));
    },

    markSongDownloaded: (songId) => {
      set((s) => ({
        queue: s.queue.map((q) =>
          q.id === songId ? { ...q, downloaded: true } : q
        ),
      }));
    },

    markSongsDownloaded: (ids) => {
      const idSet = new Set(ids);
      set((s) => ({
        queue: s.queue.map((q) =>
          idSet.has(q.id) ? { ...q, downloaded: true } : q
        ),
      }));
    },

    restorePlaybackState: async () => {
      const savedRaw = await SecureStore.getItemAsync(STATE_KEY);
      if (!savedRaw) return false;
      let saved: any;
      try {
        saved = JSON.parse(savedRaw);
      } catch {
        return false;
      }
      if (!saved || saved.currentIndex < 0) return false;

      const user = useUserStore.getState().user;
      if (!user) return false;

      const oldSnapshot =
        !(saved.version >= 2) ||
        !Array.isArray(saved.queueIds) ||
        saved.queueIds.length === 0;

      let songs: Music[] = [];
      let originalOrder: Music[] | null = null;

      if (!oldSnapshot) {
        try {
          const allMusic = (await API.get("/music", {
            user_id: user.id,
          })) as Music[];
          const byId = new Map(allMusic.map((m) => [m.id, m]));
          songs = (saved.queueIds as number[])
            .map((id) => byId.get(id))
            .filter(Boolean) as Music[];
          const originalIds = Array.isArray(saved.originalOrderIds)
            ? saved.originalOrderIds
            : saved.queueIds;
          originalOrder = (originalIds as number[])
            .map((id) => byId.get(id))
            .filter(Boolean) as Music[];
        } catch {
          return false;
        }
        if (songs.length === 0) return false;
      } else if (saved.playlistId === "-1" || saved.playlistId === "-2") {
        const allMusic = (await API.get("/music", { user_id: user.id })) as Music[];
        songs =
          saved.playlistId === "-2"
            ? allMusic.filter((m) => m.added_by === user.id)
            : allMusic;
      } else if (saved.playlistId) {
        try {
          const [playlists, allMusic] = await Promise.all([
            API.get("/playlists", { user_id: user.id }),
            API.get("/music", { user_id: user.id }),
          ]);
          const found = (playlists as Playlist[]).find(
            (p) => p.id === parseInt(saved.playlistId as string, 10)
          );
          if (!found) return false;
          songs = (found.songs || [])
            .slice()
            .sort((a, b) => a.position - b.position)
            .map((sp) => (allMusic as Music[]).find((m) => m.id === sp.music_id))
            .filter(Boolean) as Music[];
        } catch {
          return false;
        }
      } else {
        return false;
      }

      if (songs.length === 0) return false;

      let shuff: ShuffleMode = saved.shuffled === "on" ? "on" : "off";
      if (oldSnapshot && saved.playlistId) {
        const stored = await SecureStore.getItemAsync(`playlist_${saved.playlistId}_shuffled`);
        if (stored !== null) shuff = stored === "true" ? "on" : "off";
      }

      let queue = [...songs];
      let index = Math.min(saved.currentIndex, songs.length - 1);
      if (shuff === "on" && oldSnapshot) {
        queue = shuffleKeepingIndex(songs, index);
        index = queue.findIndex((s) => s.id === songs[index]?.id);
        if (index < 0) index = 0;
      }

      set({
        originalOrder: originalOrder || [...songs],
        queue,
        playlistId: saved.playlistId,
        shuffle: shuff,
        repeat: !!saved.repeat,
        currentIndex: index,
      });

      await _loadQueueToPlayer(queue, index, saved.position || 0, !!saved.playing);
      await TrackPlayer.setRepeatMode(
        saved.repeat ? RepeatMode.Queue : RepeatMode.Off
      );
      set({ isPlaying: !!saved.playing });
      return true;
    },

    savePlaybackState: async () => {
      const state = get();
      if (state.currentIndex < 0) {
        await SecureStore.deleteItemAsync(STATE_KEY);
        return;
      }
      const song = state.queue[state.currentIndex];
      if (!song) return;
      let position = 0;
      let duration = 0;
      try {
        const progress = await TrackPlayer.getProgress();
        position = progress.position || 0;
        duration = progress.duration || 0;
      } catch {}
      const s = {
        version: 2,
        playlistId: state.playlistId,
        currentIndex: state.currentIndex,
        songId: song.id,
        queueIds: state.queue.map((q) => q.id),
        originalOrderIds:
          state.originalOrder.length > 0
            ? state.originalOrder.map((q) => q.id)
            : state.queue.map((q) => q.id),
        shuffled: state.shuffle,
        repeat: state.repeat,
        playing: state.isPlaying,
        position,
        duration,
      };
      await SecureStore.setItemAsync(STATE_KEY, JSON.stringify(s));
    },

    clearPlaybackState: async () => {
      await SecureStore.deleteItemAsync(STATE_KEY);
    },
  };
});
