import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import TrackPlayer, {
  State,
  Track,
  RepeatMode,
} from "react-native-track-player";
import { API } from "../api";
import type { Music, Playlist, PlaylistSong } from "../types";

type ShuffleMode = "off" | "on";

interface MusicState {
  music: Music[];
  playlists: Playlist[];
  currentPlaylist: Playlist | null;
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
  playPlaylist: (playlist: Playlist, songs: Music[], startIndex?: number) => Promise<void>;
  playAll: (songs: Music[], startIndex?: number) => Promise<void>;
  togglePlayPause: () => Promise<void>;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  toggleShuffle: () => Promise<void>;
  toggleRepeat: () => Promise<void>;
  seekTo: (position: number) => Promise<void>;
  addToPlaylist: (playlistId: number, songIndex: number) => Promise<void>;
  _ensureSongsDownloaded: (songs: Music[]) => Promise<void>;
  _cacheSongsBackground: (songs: Music[]) => Promise<void>;
}

let _shuffledIndices: number[] = [];

function _buildShuffleQueue(length: number, startIndex: number): number[] {
  const indices = Array.from({ length }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const startPos = indices.indexOf(startIndex);
  if (startPos > 0) {
    const item = indices.splice(startPos, 1)[0];
    indices.unshift(item);
  }
  return indices;
}

function _getQueueIndices(
  songs: Music[],
  shuffle: ShuffleMode,
  startIndex: number
): number[] {
  if (shuffle === "on") {
    _shuffledIndices = _buildShuffleQueue(songs.length, startIndex);
    return _shuffledIndices;
  }
  return songs.map((_, i) => i);
}

export const useMusicStore = create<MusicState>((set, get) => ({
  music: [],
  playlists: [],
  currentPlaylist: null,
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

  playPlaylist: async (playlist, songs, startIndex = 0) => {
    const state = get();

    await get()._ensureSongsDownloaded(songs);

    const indices = _getQueueIndices(songs, state.shuffle, startIndex);

    const tracks: Track[] = [];
    for (const idx of indices) {
      const song = songs[idx];
      const url = await API.getMusicUrl(song);
      tracks.push({
        id: String(song.id),
        url,
        title: song.title,
        artist: song.artist || "Unknown",
        artwork: song.album_art || undefined,
      });
    }

    await TrackPlayer.reset();
    await TrackPlayer.add(tracks);
    await TrackPlayer.play();

    set({
      currentPlaylist: playlist,
      currentIndex: startIndex,
      isPlaying: true,
    });

    get()._cacheSongsBackground(songs);
  },

  playAll: async (songs, startIndex = 0) => {
    const state = get();

    await get()._ensureSongsDownloaded(songs);

    const indices = _getQueueIndices(songs, state.shuffle, startIndex);

    const tracks: Track[] = [];
    for (const idx of indices) {
      const song = songs[idx];
      const url = await API.getMusicUrl(song);
      tracks.push({
        id: String(song.id),
        url,
        title: song.title,
        artist: song.artist || "Unknown",
        artwork: song.album_art || undefined,
      });
    }

    await TrackPlayer.reset();
    await TrackPlayer.add(tracks);
    await TrackPlayer.play();

    set({
      currentPlaylist: null,
      currentIndex: startIndex,
      isPlaying: true,
    });

    get()._cacheSongsBackground(songs);
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
    const newMode = state.shuffle === "on" ? "off" : "on";
    set({ shuffle: newMode });
    await SecureStore.setItemAsync("shuffle", newMode);
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

  addToPlaylist: async (playlistId, songIndex) => {
    const state = get();
    const song = state.music[songIndex];
    if (!song) return;

    try {
      await API.post(`/playlists/${playlistId}/add`, {
        music_id: song.id,
      });
      await state.loadPlaylists(song.added_by);
    } catch (err: any) {
      set({ error: err.message });
    }
  },
}));
