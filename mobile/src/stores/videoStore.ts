import { create } from "zustand";
import { API } from "../api";
import { waitForServerDownload } from "../downloads";
import type { Video, Channel, Subscription } from "../types";

export type VideoFilter = "all" | "my-feed" | "unwatched" | "keep";

interface VideoState {
  videos: Video[];
  channels: Channel[];
  subscriptions: Subscription[];
  videoPlaylists: any[];
  currentFilter: VideoFilter;
  isLoading: boolean;
  error: string | null;

  loadVideos: (userId: number, filter?: string) => Promise<void>;
  loadVideoPlaylists: (userId: number) => Promise<void>;
  loadChannels: () => Promise<void>;
  loadSubscriptions: () => Promise<void>;
  markWatched: (videoId: number) => Promise<void>;
  savePosition: (videoId: number, position: number) => Promise<void>;
  toggleKeep: (videoId: number) => Promise<void>;
  downloadVideo: (videoId: number) => Promise<void>;
  downloadingIds: number[];
  deleteVideo: (videoId: number) => Promise<void>;
  setFilter: (filter: VideoFilter) => void;
  createVideoPlaylist: (name: string, userId: number) => Promise<any>;
  addVideoToPlaylist: (playlistId: number, videoId: number) => Promise<any>;
  removeVideoFromPlaylist: (playlistId: number, videoId: number) => Promise<any>;
  deleteVideoPlaylist: (playlistId: number) => Promise<void>;
  addChannel: (url: string, userId: number) => Promise<any>;
  subscribe: (channelId: number, userId: number, criteria?: any) => Promise<any>;
  unsubscribe: (subId: number) => Promise<void>;
}

export const useVideoStore = create<VideoState>((set, get) => ({
  videos: [],
  channels: [],
  subscriptions: [],
  videoPlaylists: [],
  currentFilter: "all",
  isLoading: false,
  error: null,
  downloadingIds: [],

  loadVideos: async (userId, filter) => {
    set({ isLoading: true, error: null });
    try {
      const f = filter || get().currentFilter;
      const videos = await API.get("/videos", { user_id: userId, filter: f });
      set({ videos: videos as Video[] });
    } catch (err: any) {
      set({ error: err.message });
    } finally {
      set({ isLoading: false });
    }
  },

  loadVideoPlaylists: async (userId) => {
    try {
      const playlists = await API.get("/playlists", {
        user_id: userId,
        kind: "video",
      });
      set({ videoPlaylists: playlists as any[] });
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  loadChannels: async () => {
    try {
      const channels = await API.get("/channels");
      set({ channels: channels as Channel[] });
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  loadSubscriptions: async () => {
    try {
      const subscriptions = await API.get("/subscriptions");
      set({ subscriptions: subscriptions as Subscription[] });
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  markWatched: async (videoId) => {
    const state = get();
    const current = state.videos.find((v) => v.id === videoId);
    const now = new Date().toISOString();
    const updated = state.videos.map((v) => {
      if (v.id === videoId) {
        return {
          ...v,
          watched_at: v.watched_at ? null : now,
          position: v.watched_at ? v.position : 0,
        };
      }
      return v;
    });
    set({ videos: updated });
    try {
      await API.post(`/videos/${videoId}/watch`, {
        watched: !!current?.watched_at ? false : true,
      });
    } catch (err: any) {
      set({ error: err.message });
    }
    if (current) {
      const watchedNow = !current.watched_at;
      await API.updateCachedList(
        "/videos",
        { user_id: current.added_by, filter: get().currentFilter },
        (v: any) => v.id === videoId,
        (v: any) => ({
          ...v,
          watched_at: watchedNow ? now : null,
          position: watchedNow ? 0 : v.position,
        })
      );
    }
  },

  savePosition: async (videoId, position) => {
    try {
      await API.post(`/videos/${videoId}/watch`, { position });
    } catch {}
    const state = get();
    set({
      videos: state.videos.map((v) =>
        v.id === videoId ? { ...v, position } : v
      ),
    });
    const current = state.videos.find((v) => v.id === videoId);
    if (current) {
      await API.updateCachedList(
        "/videos",
        { user_id: current.added_by, filter: get().currentFilter },
        (v: any) => v.id === videoId,
        (v: any) => ({ ...v, position })
      );
    }
  },

  toggleKeep: async (videoId) => {
    const state = get();
    const current = state.videos.find((v) => v.id === videoId);
    const updated = state.videos.map((v) => {
      if (v.id === videoId) {
        return { ...v, keep_flag: !v.keep_flag };
      }
      return v;
    });
    set({ videos: updated });
    try {
      await API.post(`/videos/${videoId}/keep`, {
        keep: !current?.keep_flag,
      });
    } catch (err: any) {
      set({ error: err.message });
    }
    if (current) {
      await API.updateCachedList(
        "/videos",
        { user_id: current.added_by, filter: get().currentFilter },
        (v: any) => v.id === videoId,
        (v: any) => ({ ...v, keep_flag: !v.keep_flag })
      );
    }
  },

  downloadVideo: async (videoId) => {
    const mark = (downloading: boolean) =>
      set((s) => ({
        downloadingIds: downloading
          ? Array.from(new Set([...s.downloadingIds, videoId]))
          : s.downloadingIds.filter((id) => id !== videoId),
      }));
    try {
      mark(true);
      await API.post(`/videos/${videoId}/download`);
      await waitForServerDownload("video", videoId);
      const updated = get().videos.map((v) =>
        v.id === videoId ? { ...v, downloaded: true } : v
      );
      set({ videos: updated });
    } catch (err: any) {
      set({ error: err.message });
    } finally {
      mark(false);
    }
  },

  deleteVideo: async (videoId) => {
    const state = get();
    const target = state.videos.find((v) => v.id === videoId);
    set({ videos: state.videos.filter((v) => v.id !== videoId) });
    try {
      await API.delete(`/videos/${videoId}`);
    } catch (err: any) {
      set({ error: err.message });
    }
    if (target) {
      await API.updateCachedList(
        "/videos",
        { user_id: target.added_by, filter: get().currentFilter },
        (v: any) => v.id === videoId,
        (v: any) => v,
        true
      );
    }
  },

  setFilter: (filter) => {
    set({ currentFilter: filter });
  },

  createVideoPlaylist: async (name, userId) => {
    try {
      const pl = await API.post("/playlists", {
        name,
        user_id: userId,
        kind: "video",
      });
      await get().loadVideoPlaylists(userId);
      return pl;
    } catch (err: any) {
      set({ error: err.message });
      throw err;
    }
  },

  addVideoToPlaylist: async (playlistId, videoId) => {
    try {
      const res = await API.post(`/playlists/${playlistId}/add`, {
        video_id: videoId,
        position: 0,
        item_type: "video",
      });
      const state = get();
      const user = state.videos.find((v) => v.id === videoId)?.added_by;
      if (user) await get().loadVideoPlaylists(user);
      return res;
    } catch (err: any) {
      set({ error: err.message });
      throw err;
    }
  },

  removeVideoFromPlaylist: async (playlistId, videoId) => {
    try {
      const res = await API.delete(
        `/playlists/${playlistId}/remove/${videoId}?item_type=video`
      );
      const pl = get().videoPlaylists.find((p) => p.id === playlistId);
      if (pl) {
        pl.songs = pl.songs.filter(
          (s: any) => !(s.type === "video" && s.video_id === videoId)
        );
        set({ videoPlaylists: [...get().videoPlaylists] });
      }
      return res;
    } catch (err: any) {
      set({ error: err.message });
      throw err;
    }
  },

  deleteVideoPlaylist: async (playlistId) => {
    try {
      await API.delete(`/playlists/${playlistId}`);
      set({
        videoPlaylists: get().videoPlaylists.filter((p) => p.id !== playlistId),
      });
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  addChannel: async (url, userId) => {
    try {
      const channel = await API.post("/channels/add", { url, user_id: userId });
      await get().loadChannels();
      return channel;
    } catch (err: any) {
      set({ error: err.message });
      throw err;
    }
  },

  subscribe: async (channelId, userId, criteria = {}) => {
    try {
      const sub = await API.post(`/channels/${channelId}/subscribe`, {
        user_id: userId,
        criteria,
      });
      await get().loadSubscriptions();
      return sub;
    } catch (err: any) {
      set({ error: err.message });
      throw err;
    }
  },

  unsubscribe: async (subId) => {
    try {
      await API.delete(`/subscriptions/${subId}`);
      await get().loadSubscriptions();
    } catch (err: any) {
      set({ error: err.message });
    }
  },
}));

export const videoThumb = (v: Video | null | undefined): string =>
  v?.thumbnail || (v?.video_id ? `https://i.ytimg.com/vi/${v.video_id}/hqdefault.jpg` : "");