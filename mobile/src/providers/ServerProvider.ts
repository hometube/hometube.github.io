import * as FileSystem from "expo-file-system/legacy";
import * as SecureStore from "expo-secure-store";
import { DataProvider } from "./DataProvider";
import type {
  User,
  Video,
  Music,
  Playlist,
  Channel,
  Subscription,
  CacheRule,
  ExportBody,
  HtMetadata,
  SwCacheStatus,
  ProviderType,
} from "../types";

const KEYS = {
  BACKEND_URL: "backendUrl",
  JWT_TOKEN: "jwt_token",
  NGROK_TOKEN: "ngrok_token",
};

export class ServerProvider extends DataProvider {
  get type(): ProviderType {
    return "server";
  }
  get name(): string {
    return "Backend Server";
  }

  private _backendUrl: string = "";
  private _jwt: string = "";
  private _ngrokToken: string = "";
  private _blobUrls: string[] = [];
  private _cachedMusicUrls: Map<number, string> = new Map();

  private get _cacheDir(): string {
    return `${FileSystem.documentDirectory}hometube_cache/`;
  }

  async init(): Promise<void> {
    this._backendUrl =
      (await SecureStore.getItemAsync(KEYS.BACKEND_URL)) || "";
    this._jwt = (await SecureStore.getItemAsync(KEYS.JWT_TOKEN)) || "";
    this._ngrokToken =
      (await SecureStore.getItemAsync(KEYS.NGROK_TOKEN)) || "";
    await this._restoreCache();
  }

  private async _restoreCache(): Promise<void> {
    try {
      const dir = this._cacheDir;
      const dirInfo = await FileSystem.getInfoAsync(dir);
      if (!dirInfo.exists) return;
      const files = await FileSystem.readDirectoryAsync(dir);
      for (const file of files) {
        const match = file.match(/^music_(\d+)\./);
        if (match) {
          const songId = parseInt(match[1], 10);
          this._cachedMusicUrls.set(songId, `${dir}${file}`);
        }
      }
    } catch (e) {
      console.log("Cache restore error:", e);
    }
  }

  setBackendUrl(url: string): void {
    this._backendUrl = url.replace(/\/+$/, "");
    SecureStore.setItemAsync(KEYS.BACKEND_URL, this._backendUrl);
  }

  setJwt(token: string): void {
    this._jwt = token;
    SecureStore.setItemAsync(KEYS.JWT_TOKEN, token);
  }

  private get _authHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this._jwt) {
      headers["Authorization"] = `Bearer ${this._jwt}`;
    } else if (this._ngrokToken) {
      headers["ngrok-skip-browser-warning"] = "true";
    }
    return headers;
  }

  private _apiUrl(path: string): string {
    let base = this._backendUrl || "/api";
    if (base !== "/api" && !base.endsWith("/api")) {
      base = `${base.replace(/\/+$/, "")}/api`;
    }
    return `${base.replace(/\/+$/, "")}/${path.replace(/^\//, "")}`;
  }

  private async _fetch<T>(
    method: string,
    path: string,
    body?: any
  ): Promise<T> {
    const url = body && method === "GET"
      ? `${this._apiUrl(path)}?${new URLSearchParams(body).toString()}`
      : this._apiUrl(path);

    const options: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json",
        ...this._authHeaders,
      },
    };
    if (body && method !== "GET") {
      options.body = JSON.stringify(body);
    }
    return this.fetchJson<T>(url, options);
  }

  async get<T = any>(path: string, query?: Record<string, any>): Promise<T> {
    return this._fetch<T>("GET", path, query);
  }

  async post<T = any>(path: string, body?: any): Promise<T> {
    return this._fetch<T>("POST", path, body);
  }

  async put<T = any>(path: string, body?: any): Promise<T> {
    return this._fetch<T>("PUT", path, body);
  }

  async delete<T = any>(path: string): Promise<T> {
    return this._fetch<T>("DELETE", path);
  }

  async exchangeToken(token: string): Promise<string> {
    const url = this._apiUrl("auth/exchange");
    const res = await this.fetchJson<{ token: string }>(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "true",
      },
      body: JSON.stringify({ token }),
    });
    this.setJwt(res.token);
    return res.token;
  }

  async ping(): Promise<boolean> {
    try {
      const url = this._apiUrl("status");
      const res = await fetch(url, {
        headers: { ...this._authHeaders },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  getVideoUrl(video: Video): string {
    if (video.filename) {
      return this._apiUrl(`files/videos/${video.filename}`);
    }
    return this._apiUrl(`files/videos/${video.video_id}.mp4`);
  }

  getMusicUrl(song: Music): string {
    const cached = this._cachedMusicUrls.get(song.id);
    if (cached) return cached;
    return this._apiUrl(`music/${song.id}/file`);
  }

  releaseUrl(url: string): void {
    this._blobUrls = this._blobUrls.filter((u) => u !== url);
  }

  releaseAllUrls(): void {
    this._blobUrls = [];
  }

  async cache(path: string, options?: Partial<CacheRule>): Promise<any> {
    const parsed = this.parsePath(path);
    if (parsed.store !== "music") return null;

    const songId = parseInt(parsed.id!, 10);
    if (isNaN(songId)) return null;

    if (this._cachedMusicUrls.has(songId)) {
      return { cached: true, path: this._cachedMusicUrls.get(songId) };
    }

    try {
      const url = this._apiUrl(`music/${songId}/file`);
      const dir = this._cacheDir;
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });

      const downloadResumable = FileSystem.createDownloadResumable(
        url,
        `${dir}music_${songId}.tmp`,
        { headers: { ...this._authHeaders } }
      );
      const result = await downloadResumable.downloadAsync();
      if (!result) return null;

      const finalPath = `${dir}music_${songId}.cache`;
      await FileSystem.moveAsync({
        from: result.uri,
        to: finalPath,
      });

      this._cachedMusicUrls.set(songId, finalPath);
      return { cached: true, path: finalPath };
    } catch (e) {
      console.log(`Cache download failed for music ${songId}:`, e);
      return null;
    }
  }

  async checkCache(paths: string[]): Promise<SwCacheStatus> {
    const status: SwCacheStatus = {};
    for (const p of paths) {
      status[p] = false;
    }
    return status;
  }

  async getMetadata(): Promise<HtMetadata> {
    const exportBody: ExportBody = {
      type: "all",
      user_id: 0,
    };
    return this.post<HtMetadata>("/export", {
      ...exportBody,
      metadata_only: true,
    });
  }

  async exportData(body: ExportBody): Promise<string> {
    const url = this._apiUrl("export");
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this._authHeaders,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Export failed: ${res.status}`);

    const blob = await res.blob();
    const reader = new FileReader();
    const base64 = await new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    const base64Data = base64.split(",")[1];

    const fileName = `hometube_export_${Date.now()}.ht`;
    const filePath = `${FileSystem.documentDirectory}${fileName}`;
    await FileSystem.writeAsStringAsync(filePath, base64Data, {
      encoding: FileSystem.EncodingType.Base64,
    });

    return fileName;
  }

  async importData(file: any): Promise<{ ok: boolean; summary: string }> {
    const url = this._apiUrl("import");
    const formData = new FormData();
    formData.append("file", {
      uri: file.uri,
      name: file.name || "import.ht",
      type: file.mimeType || "application/zip",
    } as any);

    const res = await fetch(url, {
      method: "POST",
      headers: { ...this._authHeaders },
      body: formData,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Import failed: ${text}`);
    }
    return res.json();
  }

  async downloadFile(url: string, filename: string): Promise<void> {
    const filePath = `${FileSystem.documentDirectory}${filename}`;
    const download = FileSystem.createDownloadResumable(url, filePath);
    await download.downloadAsync();
  }
}
