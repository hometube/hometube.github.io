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

export abstract class DataProvider {
  abstract get type(): ProviderType;
  abstract get name(): string;

  abstract get<T = any>(path: string, query?: Record<string, any>): Promise<T>;
  abstract post<T = any>(path: string, body?: any): Promise<T>;
  abstract put<T = any>(path: string, body?: any): Promise<T>;
  abstract delete<T = any>(path: string): Promise<T>;

  abstract exchangeToken(token: string): Promise<string>;
  abstract ping(): Promise<boolean>;

  abstract getVideoUrl(video: Video): string;
  abstract getMusicUrl(song: Music): string;
  abstract releaseUrl(url: string): void;
  abstract releaseAllUrls(): void;

  abstract getMetadata(): Promise<HtMetadata>;
  abstract exportData(body: ExportBody): Promise<string>;
  abstract importData(file: any): Promise<{ ok: boolean; summary: string }>;

  abstract cache(path: string, options?: Partial<CacheRule>): Promise<any>;
  abstract checkCache(paths: string[]): Promise<SwCacheStatus>;
  abstract downloadFile(url: string, filename: string): Promise<void>;

  buildUrl(base: string, path: string, query?: Record<string, any>): string {
    let url = `${base.replace(/\/+$/, "")}/${path.replace(/^\//, "")}`;
    if (query) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) {
          params.append(k, String(v));
        }
      }
      const qs = params.toString();
      if (qs) url += `?${qs}`;
    }
    return url;
  }

  async fetchJson<T>(
    url: string,
    options: RequestInit = {}
  ): Promise<T> {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json", ...options.headers },
      ...options,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return res.json();
  }

  protected parsePath(path: string): {
    store: string;
    id?: string;
    action?: string;
  } {
    const parts = path.replace(/^\/+/, "").split("/");
    const store = parts[0];
    if (parts.length === 1) return { store };
    if (parts.length === 2) return { store, id: parts[1] };
    return { store, id: parts[1], action: parts[2] };
  }
}
