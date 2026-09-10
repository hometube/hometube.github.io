import { create } from "zustand";
import { API } from "../api";
import type {
  Music,
  Playlist,
  PodcastFeed,
  PodcastEpisodesResponse,
  SubscriptionCriteria,
} from "../types";

interface SubscribeInput {
  url: string;
  user_id: number;
  criteria?: SubscriptionCriteria;
  check_interval?: number;
}

interface PodcastState {
  feeds: PodcastFeed[];
  episodes: Music[];
  playlists: Playlist[];
  isLoading: boolean;
  isChecking: boolean;
  error: string | null;
  loadedForUserId: number | null;

  load: (userId: number, force?: boolean) => Promise<void>;
  loadEpisodes: (subscriptionId: number) => Promise<Music[]>;
  subscribe: (
    data: SubscribeInput
  ) => Promise<{ subscription_id: number; backfilled: boolean }>;
  addEpisode: (data: {
    url: string;
    user_id: number;
    playlist_id?: number;
  }) => Promise<void>;
  checkNow: (subscriptionId: number) => Promise<void>;
  unsubscribe: (subscriptionId: number) => Promise<void>;
  createPlaylist: (name: string, userId: number) => Promise<Playlist>;
  addToPlaylist: (playlistId: number, episode: Music) => Promise<void>;
}

export const usePodcastStore = create<PodcastState>((set, get) => ({
  feeds: [],
  episodes: [],
  playlists: [],
  isLoading: false,
  isChecking: false,
  error: null,
  loadedForUserId: null,

  load: async (userId, force) => {
    if (!force && get().loadedForUserId === userId) return;
    set({ isLoading: true, error: null });
    try {
      const [feeds, playlists] = await Promise.all([
        API.get("/podcasts", { user_id: userId }),
        API.get("/playlists", { user_id: userId, kind: "podcast" }),
      ]);
      set({
        feeds: feeds as PodcastFeed[],
        playlists: playlists as Playlist[],
        loadedForUserId: userId,
      });
    } catch (err: any) {
      set({ error: err.message });
    } finally {
      set({ isLoading: false });
    }
  },

  loadEpisodes: async (subscriptionId) => {
    set({ isLoading: true, error: null });
    try {
      const res = (await API.get(`/podcasts/${subscriptionId}/episodes`, {
        user_id: undefined,
      })) as PodcastEpisodesResponse;
      set({ episodes: res.episodes });
      return res.episodes;
    } catch (err: any) {
      set({ error: err.message });
      return [];
    } finally {
      set({ isLoading: false });
    }
  },

  subscribe: async (data) => {
    const res = await API.post("/podcasts/subscribe", data);
    const uid = get().loadedForUserId;
    if (uid != null) get().load(uid, true);
    return res;
  },

  addEpisode: async (data) => {
    await API.post("/music/add", { ...data, kind: "podcast" });
    const uid = get().loadedForUserId;
    if (uid != null) get().load(uid, true);
  },

  checkNow: async (subscriptionId) => {
    set({ isChecking: true });
    try {
      await API.post(`/podcasts/${subscriptionId}/check`, {});
    } finally {
      set({ isChecking: false });
    }
    const uid = get().loadedForUserId;
    if (uid != null) get().load(uid, true);
  },

  unsubscribe: async (subscriptionId) => {
    await API.delete(`/podcasts/${subscriptionId}`);
    const uid = get().loadedForUserId;
    if (uid != null) get().load(uid, true);
  },

  createPlaylist: async (name, userId) => {
    const playlist = (await API.post("/playlists", {
      name,
      user_id: userId,
      kind: "podcast",
    })) as Playlist;
    const uid = get().loadedForUserId;
    if (uid != null) get().load(uid, true);
    return playlist;
  },

  addToPlaylist: async (playlistId, episode) => {
    await API.post(`/playlists/${playlistId}/add`, {
      music_id: episode.id,
    });
    const uid = get().loadedForUserId;
    if (uid != null) get().load(uid, true);
  },
}));