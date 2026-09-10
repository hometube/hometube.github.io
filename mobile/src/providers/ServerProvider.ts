import * as FileSystem from "expo-file-system/legacy";
import * as SecureStore from "expo-secure-store";
import { DataProvider } from "./DataProvider";
import { localDb } from "../db/localDb";
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
  REQUEST_TIMEOUT: "requestTimeout",
};

const DEFAULT_REQUEST_TIMEOUT_MS = 5000;

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
  private _requestTimeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS;
  private _reachable: boolean | null = null;
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
    const timeout = parseInt(
      (await SecureStore.getItemAsync(KEYS.REQUEST_TIMEOUT)) || "",
      10
    );
    if (!isNaN(timeout) && timeout > 0) {
      this._requestTimeoutMs = timeout * 1000;
    }
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

  setRequestTimeout(seconds: number): void {
    const value = Math.max(1, Math.round(seconds));
    this._requestTimeoutMs = value * 1000;
    SecureStore.setItemAsync(KEYS.REQUEST_TIMEOUT, String(value));
  }

  setReachable(online: boolean): void {
    this._reachable = online;
  }

  isReachable(): boolean | null {
    return this._reachable;
  }

  private async _fetchWithTimeout(
    url: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this._requestTimeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (e) {
      this._reachable = false;
      if (e instanceof Error && e.name === "AbortError") {
        throw new Error(
          `Request timed out after ${this._requestTimeoutMs / 1000}s`
        );
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
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

  async fetchJson<T>(
    url: string,
    options: RequestInit = {}
  ): Promise<T> {
    const res = await this._fetchWithTimeout(url, {
      headers: { "Content-Type": "application/json", ...options.headers },
      ...options,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    this._reachable = true;
    return res.json();
  }

  async get<T = any>(path: string, query?: Record<string, any>): Promise<T> {
    const parsed = this.parsePath(path);
    const listEndpoint =
      parsed.store === "videos" ||
      parsed.store === "music" ||
      parsed.store === "playlists" ||
      parsed.store === "channels" ||
      parsed.store === "subscriptions" ||
      parsed.store === "users" ||
      parsed.store === "podcasts";

    let result: T;
    if (listEndpoint) {
      const cacheKey = this._cacheKey(path, query);
      if (this._reachable === false) {
        const cached = await this._cachedResponse<T>(cacheKey);
        if (!cached) {
          throw new Error(
            "Server unreachable and no cached data available"
          );
        }
        result = cached;
      } else {
        try {
          result = await this._fetch<T>("GET", path, query);
          this._reachable = true;
          await this._cacheResponse(cacheKey, result);
        } catch {
          this._reachable = false;
          const cached = await this._cachedResponse<T>(cacheKey);
          if (cached) {
            result = cached;
          } else {
            throw new Error(
              "Server unreachable and no cached data available"
            );
          }
        }
      }
    } else {
      result = await this._fetch<T>("GET", path, query);
    }

    if (parsed.store === "music" && !parsed.id) {
      return (result as Music[]).map((m) => ({
        ...m,
        downloaded: this._cachedMusicUrls.has(m.id),
      })) as T;
    }

    return result;
  }

  private _cacheKey(path: string, query?: Record<string, any>): string {
    const qs = query
      ? Object.entries(query)
          .filter(([, v]) => v !== undefined && v !== null)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${k}=${v}`)
          .join("&")
      : "";
    return `GET:${path}${qs ? `?${qs}` : ""}`;
  }

  private async _cacheResponse(key: string, data: any): Promise<void> {
    try {
      await localDb.setMeta(`cache:${key}`, JSON.stringify(data));
    } catch (e) {
      console.log("Cache write error:", e);
    }
  }

  private async _cachedResponse<T>(key: string): Promise<T | null> {
    try {
      const raw = await localDb.getMeta(`cache:${key}`);
      if (raw) return JSON.parse(raw) as T;
      const base = key.split("?")[0];
      const all = await localDb.getAll("meta");
      const candidates = all
        .filter((m) => m.key.startsWith(`cache:${base}`))
        .sort((a: any, b: any) =>
          (b.updated_at || "").localeCompare(a.updated_at || "")
        );
      const match = candidates.find((m) => m.value);
      if (match) return JSON.parse(match.value) as T;
      return null;
    } catch {
      return null;
    }
  }

  async updateCachedList<T = any>(
    path: string,
    query: Record<string, any>,
    predicate: (item: T) => boolean,
    update: (item: T) => T,
    remove = false
  ): Promise<void> {
    const cacheKey = this._cacheKey(path, query);
    try {
      const raw = await localDb.getMeta(`cache:${cacheKey}`);
      if (!raw) return;
      const list: T[] = JSON.parse(raw);
      const updated = remove
        ? list.filter((item) => !predicate(item))
        : list.map((item) => (predicate(item) ? update(item) : item));
      await localDb.setMeta(`cache:${cacheKey}`, JSON.stringify(updated));
    } catch (e) {
      console.log("Cache update error:", e);
    }
  }

  isMusicCached(songId: number): boolean {
    return this._cachedMusicUrls.has(songId);
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
      const res = await this._fetchWithTimeout(url, {
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
    const res = await this._fetchWithTimeout(url, {
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

    const res = await this._fetchWithTimeout(url, {
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
