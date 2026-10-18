import { create } from "zustand";
import { API } from "../api";
import { waitForServerDownload } from "../downloads";
import { useLibraryStore } from "./libraryStore";
import { useMusicStore } from "./musicStore";
import { usePodcastStore } from "./podcastStore";
import type { Music } from "../types";

interface DownloadState {
  isDownloading: boolean;
  downloadingIds: number[];

  downloadForOffline: (songs: Music[]) => Promise<void>;
  removeOfflineDownload: (songs: Music[]) => Promise<void>;
  ensureSongsDownloaded: (songs: Music[]) => Promise<void>;
}

const setSongDownloaded = (songId: number, downloaded = true) => {
  useLibraryStore.getState().setSongDownloaded(songId, downloaded);
  useMusicStore.getState().markSongDownloaded(songId, downloaded);
  usePodcastStore.getState().markEpisodeDownloaded(songId, downloaded);
};

const setSongDownloading = (songId: number, downloading: boolean) => {
  useDownloadStore.setState((s) => {
    const has = s.downloadingIds.includes(songId);
    const downloadingIds =
      downloading && !has
        ? [...s.downloadingIds, songId]
        : !downloading && has
        ? s.downloadingIds.filter((id) => id !== songId)
        : s.downloadingIds;
    return { downloadingIds };
  });
};

const runBatched = async (
  songs: Music[],
  concurrency: number,
  worker: (song: Music) => Promise<void>
) => {
  const queue = [...songs];
  const workers = Array.from(
    { length: Math.min(concurrency, queue.length) },
    async () => {
      while (queue.length > 0) {
        const song = queue.shift()!;
        setSongDownloading(song.id, true);
        try {
          await worker(song);
        } finally {
          setSongDownloading(song.id, false);
        }
      }
    }
  );
  await Promise.all(workers);
};

export const useDownloadStore = create<DownloadState>((set) => ({
  isDownloading: false,
  downloadingIds: [],

  removeOfflineDownload: async (songs) => {
    const cached = songs.filter((s) => s.downloaded);
    if (cached.length === 0) return;

    set({ isDownloading: true });

    await runBatched(cached, 8, async (song) => {
      try {
        await API.uncache(`/music/${song.id}/file`);
        setSongDownloaded(song.id, false);
      } catch (err: any) {
        console.log(`Remove offline error for song ${song.id}: ${err.message}`);
      }
    });

    set({ isDownloading: false });
  },

  ensureSongsDownloaded: async (songs: Music[]) => {
    const undownloaded = songs.filter((s) => !s.downloaded);
    if (undownloaded.length === 0) return;

    set({ isDownloading: true });

    await runBatched(undownloaded, 8, async (song) => {
      try {
        await API.post(`/music/${song.id}/download`, {});
        await waitForServerDownload("music", song.id);
        setSongDownloaded(song.id);
      } catch (err: any) {
        console.log(`Download error for song ${song.id}: ${err.message}`);
      }
    });

    set({ isDownloading: false });
  },

  downloadForOffline: async (songs: Music[]) => {
    const undownloaded = songs.filter((s) => !s.downloaded);
    if (undownloaded.length === 0) return;

    set({ isDownloading: true });

    await runBatched(undownloaded, 8, async (song) => {
      try {
        const res = await API.cache(`/music/${song.id}/file`, {
          ttl: 0,
          refetch: false,
        });
        if (res) setSongDownloaded(song.id);
      } catch (err: any) {
        console.log(`Offline download error for song ${song.id}: ${err.message}`);
      }
    });

    set({ isDownloading: false });
  },
}));
