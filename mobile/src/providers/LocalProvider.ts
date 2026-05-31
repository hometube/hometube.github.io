import { DataProvider } from "./DataProvider";
import { localDb } from "../db/localDb";
import * as FileSystem from "expo-file-system/legacy";
import { unzip, zip } from "fflate";
import type {
  User,
  Video,
  Music,
  Playlist,
  PlaylistSong,
  Channel,
  Subscription,
  CacheRule,
  ExportBody,
  HtMetadata,
  SwCacheStatus,
  ProviderType,
} from "../types";

export class LocalProvider extends DataProvider {
  get type(): ProviderType {
    return "local";
  }
  get name(): string {
    return "Local Mode";
  }

  private _fileUrls: Map<string, string> = new Map();

  async init(): Promise<void> {
    await localDb.init();
  }

  async get<T = any>(path: string, query?: Record<string, any>): Promise<T> {
    const parsed = this.parsePath(path);
    const { store } = parsed;

    if (store === "users") {
      const users = await localDb.getAll("users");
      return users as T;
    }

    if (store === "channels") {
      if (parsed.action === "videos") {
        const videos = await localDb.getAll("videos");
        return videos.filter(
          (v: any) => v.channel_id === Number(parsed.id)
        ) as T;
      }
      const channels = await localDb.getAll("channels");
      return channels as T;
    }

    if (store === "videos") {
      if (parsed.id === "info") {
        throw new Error("Cannot fetch video info in local mode");
      }
      let videos = await localDb.getAll<Video>("videos");
      const files = await localDb.getFilesByType("video");
      const fileIds = new Set(files.map((f: any) => f.id));

      videos = videos.map((v) => ({
        ...v,
        downloaded: fileIds.has(v.video_id),
        channel_name: "",
      }));

      if (query?.user_id) {
        videos = videos.filter((v) => v.added_by === Number(query.user_id));
      }
      if (query?.filter === "unwatched") {
        videos = videos.filter((v) => !v.watched_at);
      }
      if (query?.filter === "my-feed") {
        const subs = await localDb.getAll("subscriptions");
        const channelIds = new Set(
          subs
            .filter((s: any) => s.user_id === Number(query.user_id))
            .map((s: any) => s.channel_id)
        );
        videos = videos.filter((v) => channelIds.has(v.channel_id!));
      }
      return videos.sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      ) as T;
    }

    if (store === "music") {
      if (parsed.id === "info") {
        throw new Error("Cannot fetch music info in local mode");
      }
      let allMusic = await localDb.getAll<Music>("music");
      const files = await localDb.getFilesByType("music");
      const fileIds = new Set(files.map((f: any) => f.id));

      allMusic = allMusic.map((m) => ({
        ...m,
        downloaded: fileIds.has(`${m.id}`),
      }));

      if (query?.user_id) {
        allMusic = allMusic.filter(
          (m) => m.added_by === Number(query.user_id)
        );
      }
      if (query?.playlist_id) {
        const playlist = await localDb.get<Playlist>(
          "playlists",
          Number(query.playlist_id)
        );
        if (playlist) {
          const songIds = new Set(
            playlist.songs.map((s: PlaylistSong) => s.music_id)
          );
          allMusic = allMusic.filter((m) => songIds.has(m.id));
        }
      }
      return allMusic.sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      ) as T;
    }

    if (store === "playlists") {
      let playlists = await localDb.getAll<Playlist>("playlists");
      if (query?.user_id) {
        playlists = playlists.filter(
          (p) => p.user_id === Number(query.user_id)
        );
      }
      return playlists as T;
    }

    if (store === "downloads") {
      return [] as T;
    }

    if (store === "export") {
      return (await this.getMetadata()) as T;
    }

    return null as T;
  }

  async post<T = any>(path: string, body?: any): Promise<T> {
    const parsed = this.parsePath(path);
    const { store, id, action } = parsed;

    if (store === "users") {
      const existing = await localDb.getAll("users");
      const found = existing.find(
        (u: any) => u.username === body.username
      );
      if (found) return found as T;
      const newUser = { ...body, id: Date.now() };
      await localDb.store("users", newUser);
      return newUser as T;
    }

    if (store === "videos" && action === "add") {
      throw new Error("Cannot add videos in local mode");
    }

    if (store === "videos" && id && action === "watch") {
      const video = await localDb.get<Video>("videos", Number(id));
      if (video) {
        video.watched_at = video.watched_at
          ? null as any
          : new Date().toISOString();
        await localDb.store("videos", video);
      }
      return video as T;
    }

    if (store === "videos" && id && action === "keep") {
      const video = await localDb.get<Video>("videos", Number(id));
      if (video) {
        video.keep_flag = !video.keep_flag;
        await localDb.store("videos", video);
      }
      return video as T;
    }

    if (store === "videos" && id && action === "download") {
      throw new Error("Cannot download in local mode");
    }

    if (store === "channels" && action === "add") {
      throw new Error("Cannot add channels in local mode");
    }

    if (store === "subscriptions") {
      throw new Error("Cannot manage subscriptions in local mode");
    }

    if (store === "music" && action === "add") {
      throw new Error("Cannot add music in local mode");
    }

    if (store === "music" && id && action === "download") {
      throw new Error("Cannot download in local mode");
    }

    if (store === "playlists" && !id) {
      const newPlaylist: Playlist = {
        id: Date.now(),
        name: body.name,
        user_id: body.user_id,
        created_at: new Date().toISOString(),
        songs: [],
      };
      await localDb.store("playlists", newPlaylist);
      return newPlaylist as T;
    }

    if (store === "playlists" && id && action === "add") {
      const playlist = await localDb.get<Playlist>("playlists", Number(id));
      if (playlist) {
        const existing = playlist.songs.find(
          (s: PlaylistSong) => s.music_id === body.music_id
        );
        if (!existing) {
          const maxPos = Math.max(
            0,
            ...playlist.songs.map((s: PlaylistSong) => s.position)
          );
          playlist.songs.push({
            music_id: body.music_id,
            position: maxPos + 1,
          });
          await localDb.store("playlists", playlist);
        }
      }
      return playlist as T;
    }

    if (store === "export") {
      return (await this._doExport(body)) as T;
    }

    return null as T;
  }

  async put<T = any>(path: string, body?: any): Promise<T> {
    const parsed = this.parsePath(path);
    const { store, id } = parsed;

    if (store === "playlists" && id) {
      const playlist = await localDb.get<Playlist>("playlists", Number(id));
      if (playlist) {
        Object.assign(playlist, body);
        await localDb.store("playlists", playlist);
      }
      return playlist as T;
    }

    if (store === "music" && id) {
      const music = await localDb.get<Music>("music", Number(id));
      if (music) {
        Object.assign(music, body);
        await localDb.store("music", music);
      }
      return music as T;
    }

    if (store === "videos" && id) {
      const video = await localDb.get<Video>("videos", Number(id));
      if (video) {
        Object.assign(video, body);
        await localDb.store("videos", video);
      }
      return video as T;
    }

    return null as T;
  }

  async delete<T = any>(path: string): Promise<T> {
    const parsed = this.parsePath(path);
    const { store, id, action } = parsed;

    if (store === "playlists" && id && action === "remove") {
      const [musicId] = parsed.action!.split("/");
      const playlist = await localDb.get<Playlist>("playlists", Number(id));
      if (playlist) {
        playlist.songs = playlist.songs.filter(
          (s: PlaylistSong) => s.music_id !== Number(musicId)
        );
        await localDb.store("playlists", playlist);
      }
      return playlist as T;
    }

    if (store === "playlists" && id && !action) {
      await localDb.delete("playlists", Number(id));
      return true as T;
    }

    if (store === "subscriptions" && id) {
      await localDb.delete("subscriptions", Number(id));
      return true as T;
    }

    if (store === "videos" && id) {
      const video = await localDb.get<Video>("videos", Number(id));
      if (video) {
        await localDb.delete("videos", Number(id));
        const file = await localDb.getFile(video.video_id);
        if (file) {
          try {
            await FileSystem.deleteAsync(file.file_path, {
              idempotent: true,
            });
          } catch {}
          await localDb.delete("files", file.id);
        }
      }
      return true as T;
    }

    if (store === "music" && id) {
      const music = await localDb.get<Music>("music", Number(id));
      if (music) {
        await localDb.delete("music", Number(id));
        const file = await localDb.getFile(`${music.id}`);
        if (file) {
          try {
            await FileSystem.deleteAsync(file.file_path, {
              idempotent: true,
            });
          } catch {}
          await localDb.delete("files", file.id);
        }
      }
      return true as T;
    }

    return false as T;
  }

  async exchangeToken(token: string): Promise<string> {
    throw new Error("Not available in local mode");
  }

  async ping(): Promise<boolean> {
    return true;
  }

  getVideoUrl(video: Video): string {
    const existingUrl = this._fileUrls.get(`video_${video.id}`);
    if (existingUrl) return existingUrl;
    return `/api/local/video/${video.id}/file`;
  }

  getMusicUrl(song: Music): string {
    const existingUrl = this._fileUrls.get(`music_${song.id}`);
    if (existingUrl) return existingUrl;
    return `/api/local/music/${song.id}/file`;
  }

  releaseUrl(url: string): void {
    for (const [key, val] of this._fileUrls) {
      if (val === url) {
        this._fileUrls.delete(key);
        break;
      }
    }
  }

  releaseAllUrls(): void {
    this._fileUrls.clear();
  }

  async _resolveLocalFileUrl(
    type: "music" | "video",
    id: number
  ): Promise<string | null> {
    const fileKey = `${type}_${id}`;
    const cached = this._fileUrls.get(fileKey);
    if (cached) return cached;

    const fileRecord = await localDb.getFile(`${type}_${id}`);
    if (fileRecord) {
      const fileUri = fileRecord.file_path;
      this._fileUrls.set(fileKey, fileUri);
      return fileUri;
    }

    if (type === "music") {
      const music = await localDb.get<Music>("music", id);
      if (music?.filename) {
        const fileRecord2 = await localDb.getFile(
          `music_${music.filename}`
        );
        if (fileRecord2) {
          this._fileUrls.set(fileKey, fileRecord2.file_path);
          return fileRecord2.file_path;
        }
        const filePath = `${FileSystem.documentDirectory}hometube_files/${music.filename}`;
        const exists = await FileSystem.getInfoAsync(filePath);
        if (exists.exists) {
          this._fileUrls.set(fileKey, filePath);
          return filePath;
        }
      }
    }

    return null;
  }

  async cache(path: string, options?: Partial<CacheRule>): Promise<any> {
    return null;
  }

  async checkCache(paths: string[]): Promise<SwCacheStatus> {
    const status: SwCacheStatus = {};
    for (const p of paths) {
      status[p] = false;
    }
    return status;
  }

  async getMetadata(): Promise<HtMetadata> {
    const [users, channels, subscriptions, videos, music, playlists, settings] =
      await Promise.all([
        localDb.getAll("users"),
        localDb.getAll("channels"),
        localDb.getAll("subscriptions"),
        localDb.getAll("videos"),
        localDb.getAll("music"),
        localDb.getAll("playlists"),
        localDb.getAll("settings"),
      ]);

    return {
      version: "1.0",
      exported_at: new Date().toISOString(),
      users,
      channels,
      subscriptions,
      videos,
      music,
      playlists,
      settings,
    };
  }

  async exportData(body: ExportBody): Promise<string> {
    return this._doExport(body);
  }

  private async _doExport(body: ExportBody): Promise<string> {
    const metadata = await this.getMetadata();
    const zipData = await new Promise<Uint8Array>((resolve, reject) => {
      const files: Record<string, Uint8Array> = {};

      const metaStr = JSON.stringify(metadata, null, 2);
      const encoder = new TextEncoder();
      files["metadata.json"] = encoder.encode(metaStr);

      const allMusic = metadata.music;
      for (const song of allMusic) {
        if (song.downloaded) {
          const fileKey = song.filename
            ? `music_${song.filename}`
            : `music_${song.id}`;
        }
      }

      zip(
        files,
        { level: 6 },
        (err, data) => {
          if (err) reject(err);
          else resolve(data);
        }
      );
    });

    const fileName = `hometube_export_${Date.now()}.ht`;
    const filePath = `${FileSystem.documentDirectory}${fileName}`;
    const base64 = arrayToBase64(zipData);
    await FileSystem.writeAsStringAsync(filePath, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return fileName;
  }

  async importData(file: { uri: string; name?: string }): Promise<{ ok: boolean; summary: string }> {
    const base64Data = await FileSystem.readAsStringAsync(file.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const zipData = base64ToArray(base64Data);

    const unzipped = await new Promise<Record<string, Uint8Array>>(
      (resolve, reject) => {
        unzip(zipData, (err, data) => {
          if (err) reject(err);
          else resolve(data);
        });
      }
    );

    const metaRaw = new TextDecoder().decode(unzipped["metadata.json"]);
    const metadata: HtMetadata = JSON.parse(metaRaw);

    const idMap: Record<string, Record<number, number>> = {
      users: {},
      channels: {},
      subscriptions: {},
      videos: {},
      music: {},
      playlists: {},
    };

    await localDb.clearAll();

    for (const user of metadata.users) {
      const newId = Date.now() + Math.random();
      idMap.users[user.id] = newId;
      await localDb.store("users", { ...user, id: newId });
    }

    for (const channel of metadata.channels) {
      const newId = Date.now() + Math.random();
      idMap.channels[channel.id] = newId;
      await localDb.store("channels", { ...channel, id: newId });
    }

    for (const sub of metadata.subscriptions) {
      await localDb.store("subscriptions", {
        ...sub,
        id: Date.now() + Math.random(),
        channel_id: idMap.channels[sub.channel_id] || sub.channel_id,
        user_id: idMap.users[sub.user_id] || sub.user_id,
      });
    }

    for (const video of metadata.videos) {
      const newId = Date.now() + Math.random();
      idMap.videos[video.id] = newId;
      await localDb.store("videos", {
        ...video,
        id: newId,
        channel_id: video.channel_id
          ? idMap.channels[video.channel_id] || video.channel_id
          : null,
        added_by: idMap.users[video.added_by] || video.added_by,
      });
      const fileKey = `video_${video.video_id}`;
      const zipFile = unzipped[`videos/${video.video_id}.mp4`];
      if (zipFile) {
        const b64 = arrayToBase64(zipFile);
        const filePath = `${FileSystem.documentDirectory}hometube_files/${video.video_id}.mp4`;
        await FileSystem.writeAsStringAsync(filePath, b64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        await localDb.store("files", {
          id: fileKey,
          type: "video",
          file_path: filePath,
          title: video.title,
        });
      }
    }

    for (const song of metadata.music) {
      const newId = Date.now() + Math.random();
      idMap.music[song.id] = newId;
      await localDb.store("music", {
        ...song,
        id: newId,
        added_by: idMap.users[song.added_by] || song.added_by,
      });
      const fileName = song.filename || `${song.id}`;
      const fileKey = `music_${fileName}`;
      let zipFile = unzipped[`music/${fileName}`];
      if (!zipFile) {
        const altKey = Object.keys(unzipped).find(
          (k) => k.startsWith("music/") && k.includes(`${song.video_id}`)
        );
        if (altKey) zipFile = unzipped[altKey];
      }
      if (zipFile) {
        const b64 = arrayToBase64(zipFile);
        const filePath = `${FileSystem.documentDirectory}hometube_files/${fileName}`;
        await FileSystem.writeAsStringAsync(filePath, b64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        await localDb.store("files", {
          id: fileKey,
          type: "music",
          file_path: filePath,
          title: song.title,
        });
      }
    }

    for (const playlist of metadata.playlists) {
      await localDb.store("playlists", {
        ...playlist,
        id: Date.now() + Math.random(),
        user_id: idMap.users[playlist.user_id] || playlist.user_id,
        songs: (playlist.songs || []).map((s: PlaylistSong) => ({
          music_id: idMap.music[s.music_id] || s.music_id,
          position: s.position,
        })),
      });
    }

    for (const setting of metadata.settings) {
      await localDb.store("settings", setting);
    }

    return {
      ok: true,
      summary: `Imported ${metadata.users.length} users, ${metadata.videos.length} videos, ${metadata.music.length} songs, ${metadata.playlists.length} playlists`,
    };
  }

  async downloadFile(url: string, filename: string): Promise<void> {
    throw new Error("Download not available in local mode");
  }
}

function arrayToBase64(arr: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < arr.length; i++) {
    binary += String.fromCharCode(arr[i]);
  }
  return btoa(binary);
}

function base64ToArray(base64: string): Uint8Array {
  const binary = atob(base64);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    arr[i] = binary.charCodeAt(i);
  }
  return arr;
}
