import { create } from "zustand";
import { API } from "../api";
import type { Video, Channel, Subscription } from "../types";

interface VideoState {
  videos: Video[];
  channels: Channel[];
  subscriptions: Subscription[];
  currentFilter: "all" | "my-feed" | "unwatched";
  isLoading: boolean;
  error: string | null;

  loadVideos: (userId: number, filter?: string) => Promise<void>;
  loadChannels: () => Promise<void>;
  loadSubscriptions: () => Promise<void>;
  markWatched: (videoId: number) => Promise<void>;
  toggleKeep: (videoId: number) => Promise<void>;
  downloadVideo: (videoId: number) => Promise<void>;
  deleteVideo: (videoId: number) => Promise<void>;
  setFilter: (filter: "all" | "my-feed" | "unwatched") => void;
  addChannel: (url: string, userId: number) => Promise<any>;
  subscribe: (channelId: number, userId: number, criteria?: any) => Promise<any>;
  unsubscribe: (subId: number) => Promise<void>;
}

export const useVideoStore = create<VideoState>((set, get) => ({
  videos: [],
  channels: [],
  subscriptions: [],
  currentFilter: "all",
  isLoading: false,
  error: null,

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
    const updated = state.videos.map((v) => {
      if (v.id === videoId) {
        return {
          ...v,
          watched_at: v.watched_at ? null : new Date().toISOString(),
        };
      }
      return v;
    });
    set({ videos: updated });
    try {
      await API.post(`/videos/${videoId}/watch`);
    } catch (err: any) {
      set({ error: err.message });
    }
    if (current) {
      await API.updateCachedList(
        "/videos",
        { user_id: current.added_by, filter: get().currentFilter },
        (v: any) => v.id === videoId,
        (v: any) => ({
          ...v,
          watched_at: v.watched_at ? null : new Date().toISOString(),
        })
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
      await API.post(`/videos/${videoId}/keep`);
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
    try {
      await API.post(`/videos/${videoId}/download`);
      const state = get();
      const updated = state.videos.map((v) => {
        if (v.id === videoId) return { ...v, downloaded: true };
        return v;
      });
      set({ videos: updated });
    } catch (err: any) {
      set({ error: err.message });
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
