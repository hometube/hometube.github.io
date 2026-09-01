import { create } from "zustand";
import { API } from "../api";
import type { Music, Playlist } from "../types";

interface LibraryState {
  music: Music[];
  playlists: Playlist[];
  isLoading: boolean;
  error: string | null;
  loadedForUserId: number | null;

  loadMusic: (userId: number, force?: boolean) => Promise<void>;
  loadPlaylists: (userId: number, force?: boolean) => Promise<void>;
  addToPlaylist: (playlistId: number, song: Music) => Promise<void>;
  setSongDownloaded: (songId: number) => void;
  setSongsDownloaded: (ids: number[]) => void;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  music: [],
  playlists: [],
  isLoading: false,
  error: null,
  loadedForUserId: null,

  loadMusic: async (userId, force) => {
    if (!force && get().loadedForUserId === userId) return;
    set({ isLoading: true, error: null });
    try {
      const music = await API.get("/music", { user_id: userId });
      set({ music: music as Music[], loadedForUserId: userId });
    } catch (err: any) {
      set({ error: err.message });
    } finally {
      set({ isLoading: false });
    }
  },

  loadPlaylists: async (userId, force) => {
    if (!force && get().loadedForUserId === userId) return;
    set({ isLoading: true, error: null });
    try {
      const playlists = await API.get("/playlists", { user_id: userId });
      set({ playlists: playlists as Playlist[], loadedForUserId: userId });
    } catch (err: any) {
      set({ error: err.message });
    } finally {
      set({ isLoading: false });
    }
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

  setSongDownloaded: (songId) => {
    set((s) => ({
      music: s.music.map((m) =>
        m.id === songId ? { ...m, downloaded: true } : m
      ),
    }));
  },

  setSongsDownloaded: (ids) => {
    const idSet = new Set(ids);
    set((s) => ({
      music: s.music.map((m) =>
        idSet.has(m.id) ? { ...m, downloaded: true } : m
      ),
    }));
  },
}));
