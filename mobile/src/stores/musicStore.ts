import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import TrackPlayer, {
  State,
  Track,
  RepeatMode,
  Event,
} from "react-native-track-player";
import { API } from "../api";
import { useUserStore } from "./userStore";
import type { Music, Playlist } from "../types";

type ShuffleMode = "off" | "on";

const STATE_KEY = "musicPlayerState";

export function cleanTitle(title?: string | null): string {
  if (!title) return title ?? "";
  return title.replace(/\s*\[[^\]]+\]\s*$/, "");
}

interface MusicState {
  music: Music[];
  playlists: Playlist[];
  queue: Music[];
  originalOrder: Music[];
  playlistId: string | null;
  currentIndex: number;
  isPlaying: boolean;
  shuffle: ShuffleMode;
  repeat: boolean;
  isLoading: boolean;
  isDownloading: boolean;
  downloadProgress: string;
  error: string | null;

  loadMusic: (userId: number) => Promise<void>;
  loadPlaylists: (userId: number) => Promise<void>;
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

  hasActiveQueue: () => boolean;
  isInQueue: (songId: number) => boolean;
  addToQueueNext: (song: Music) => Promise<void>;
  addToQueue: (song: Music) => Promise<void>;
  removeFromQueue: (songId: number) => Promise<void>;

  addToPlaylist: (playlistId: number, song: Music) => Promise<void>;
  _ensureSongsDownloaded: (songs: Music[]) => Promise<void>;
  _cacheSongsBackground: (songs: Music[]) => Promise<void>;

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

async function trackFor(song: Music): Promise<Track> {
  const url = await API.getMusicUrl(song);
  return {
    id: String(song.id),
    url,
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
      useMusicStore.setState({ currentIndex: idx });
      useMusicStore.getState().savePlaybackState();
    }
  );

  TrackPlayer.addEventListener(Event.PlaybackState, (payload: any) => {
    useMusicStore.setState({ isPlaying: payload.state === State.Playing });
    useMusicStore.getState().savePlaybackState();
  });
}

export const useMusicStore = create<MusicState>((set, get) => {
  const _loadQueueToPlayer = async (
    queue: Music[],
    index: number,
    position = 0,
    shouldPlay = true
  ) => {
    const tracks: Track[] = [];
    for (const song of queue) {
      tracks.push(await trackFor(song));
    }
    await TrackPlayer.reset();
    if (tracks.length > 0) {
      await TrackPlayer.add(tracks);
      const activeIndex = Math.min(Math.max(index, 0), tracks.length - 1);
      await TrackPlayer.skip(activeIndex, position);
    }
    if (shouldPlay) {
      await TrackPlayer.play();
    } else {
      await TrackPlayer.pause();
    }
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

  return {
    music: [],
    playlists: [],
    queue: [],
    originalOrder: [],
    playlistId: null,
    currentIndex: -1,
    isPlaying: false,
    shuffle: "off",
    repeat: false,
    isLoading: false,
    isDownloading: false,
    downloadProgress: "",
    error: null,

    loadMusic: async (userId) => {
      set({ isLoading: true, error: null });
      try {
        const music = await API.get("/music", { user_id: userId });
        set({ music: music as Music[] });
      } catch (err: any) {
        set({ error: err.message });
      } finally {
        set({ isLoading: false });
      }
    },

    loadPlaylists: async (userId) => {
      set({ isLoading: true, error: null });
      try {
        const playlists = await API.get("/playlists", { user_id: userId });
        set({ playlists: playlists as Playlist[] });
      } catch (err: any) {
        set({ error: err.message });
      } finally {
        set({ isLoading: false });
      }
    },

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

    _ensureSongsDownloaded: async (songs: Music[]) => {
      const undownloaded = songs.filter((s) => !s.downloaded);
      if (undownloaded.length === 0) return;

      set({ isDownloading: true, downloadProgress: "" });

      for (let i = 0; i < undownloaded.length; i++) {
        const song = undownloaded[i];
        set({ downloadProgress: `Downloading ${i + 1}/${undownloaded.length}: ${song.title || song.url}` });
        try {
          await API.post(`/music/${song.id}/download`, {});
        } catch (err: any) {
          console.log(`Download error for song ${song.id}: ${err.message}`);
        }
      }

      set({ isDownloading: false, downloadProgress: "" });
    },

    _cacheSongsBackground: async (songs: Music[]) => {
      for (const song of songs) {
        try {
          await API.cache(`/music/${song.id}/file`, { ttl: 0, refetch: false });
        } catch {}
      }
    },

    playSong: async (index) => {
      const state = get();
      const song = state.queue[index];
      if (!song) return;
      await _loadQueueToPlayer(state.queue, index, 0, true);
      set({ currentIndex: index, isPlaying: true });
      get()._cacheSongsBackground([song]);
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
      if (state.shuffle !== "on") {
        await get().toggleShuffle();
      }
      const first = get().queue[0];
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

    hasActiveQueue: () => get().queue.length > 0,

    isInQueue: (songId) => get().queue.some((s) => s.id === songId),

    addToQueueNext: async (song) => {
      const state = get();
      const index = state.currentIndex >= 0 ? state.currentIndex + 1 : state.queue.length;
      const queue = [...state.queue];
      queue.splice(index, 0, { ...song });
      set({ queue });
      await _rebuildQueueToPlayer();
    },

    addToQueue: async (song) => {
      const state = get();
      if (state.queue.some((s) => s.id === song.id)) return;
      set({ queue: [...state.queue, { ...song }] });
      await _rebuildQueueToPlayer();
    },

    removeFromQueue: async (songId) => {
      const state = get();
      const queue = state.queue.filter((s) => s.id !== songId);
      set({ queue });
      await _rebuildQueueToPlayer();
    },

    addToPlaylist: async (playlistId, song) => {
      try {
        await API.post(`/playlists/${playlistId}/add`, {
          music_id: song.id,
        });
        await get().loadPlaylists(song.added_by);
      } catch (err: any) {
        set({ error: err.message });
      }
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

      let songs: Music[] = [];
      if (saved.playlistId === "-1" || saved.playlistId === "-2") {
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
      if (saved.playlistId) {
        const stored = await SecureStore.getItemAsync(`playlist_${saved.playlistId}_shuffled`);
        if (stored !== null) shuff = stored === "true" ? "on" : "off";
      }

      let queue = [...songs];
      let index = Math.min(saved.currentIndex, songs.length - 1);
      if (shuff === "on") {
        queue = shuffleKeepingIndex(songs, index);
        index = queue.findIndex((s) => s.id === songs[index]?.id);
        if (index < 0) index = 0;
      }

      set({
        originalOrder: [...songs],
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
        playlistId: state.playlistId,
        currentIndex: state.currentIndex,
        songId: song.id,
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