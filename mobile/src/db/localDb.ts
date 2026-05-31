import * as SQLite from "expo-sqlite";
import * as FileSystem from "expo-file-system/legacy";
import type { Music } from "../types";

type StoreName =
  | "users"
  | "channels"
  | "subscriptions"
  | "videos"
  | "music"
  | "playlists"
  | "settings"
  | "files"
  | "meta";

const DB_NAME = "hometube-local.db";
const FILE_DIR = `${FileSystem.documentDirectory}hometube_files/`;

class LocalDB {
  private db: SQLite.SQLiteDatabase | null = null;
  private _initializing: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this._initializing) return this._initializing;
    if (this.db) return;
    this._initializing = this._init();
    try {
      await this._initializing;
    } finally {
      this._initializing = null;
    }
  }

  private async _init(): Promise<void> {
    this.db = await SQLite.openDatabaseAsync(DB_NAME);
    await this.createTables();
    try {
      const dir = await FileSystem.getInfoAsync(FILE_DIR);
      if (!dir.exists) {
        await FileSystem.makeDirectoryAsync(FILE_DIR, { intermediates: true });
      }
    } catch {
      // non-critical — DB works without file storage
    }
  }

  private async ensureDb(): Promise<SQLite.SQLiteDatabase> {
    if (!this.db) await this.init();
    return this.db!;
  }

  private async createTables(): Promise<void> {
    const db = await this.ensureDb();
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE
      );
      CREATE TABLE IF NOT EXISTS channels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL,
        name TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        criteria TEXT,
        check_interval INTEGER DEFAULT 3600,
        last_checked TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (channel_id) REFERENCES channels(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS videos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        video_id TEXT NOT NULL,
        title TEXT NOT NULL,
        channel_id INTEGER,
        url TEXT NOT NULL,
        downloaded INTEGER DEFAULT 0,
        added_by INTEGER,
        watched_at TEXT,
        keep_flag INTEGER DEFAULT 0,
        quality TEXT DEFAULT 'best',
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (channel_id) REFERENCES channels(id),
        FOREIGN KEY (added_by) REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS music (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        video_id TEXT NOT NULL,
        url TEXT NOT NULL,
        title TEXT NOT NULL,
        artist TEXT,
        album_art TEXT,
        filename TEXT,
        is_playlist INTEGER DEFAULT 0,
        playlist_id TEXT,
        downloaded INTEGER DEFAULT 0,
        added_by INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (added_by) REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS playlists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        songs TEXT DEFAULT '[]',
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        file_path TEXT NOT NULL,
        title TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);
  }

  async getAll<T = any>(storeName: StoreName): Promise<T[]> {
    return await (await this.ensureDb()).getAllAsync<T>(`SELECT * FROM ${storeName}`);
  }

  async get<T = any>(storeName: StoreName, id: number | string): Promise<T | null> {
    const col = storeName === "settings" || storeName === "files" || storeName === "meta" ? "key" : "id";
    return await (await this.ensureDb()).getFirstAsync<T>(
      `SELECT * FROM ${storeName} WHERE ${col} = ?`,
      id
    );
  }

  async store(storeName: StoreName, records: any | any[]): Promise<void> {
    const list = Array.isArray(records) ? records : [records];
    for (const record of list) {
      if (storeName === "settings" || storeName === "meta") {
        await (await this.ensureDb()).runAsync(
          `INSERT OR REPLACE INTO ${storeName} (key, value, updated_at) VALUES (?, ?, datetime('now'))`,
          record.key,
          typeof record.value === "string" ? record.value : JSON.stringify(record.value)
        );
      } else {
        const existing = await this.get(storeName, record.id);
        if (existing) {
          await (await this.ensureDb()).runAsync(`DELETE FROM ${storeName} WHERE id = ?`, record.id);
        }
        const recordWithDates = {
          ...record,
          created_at: record.created_at || new Date().toISOString(),
        };
        const cols = Object.keys(recordWithDates).filter((k) => k !== "id");
        const vals = cols.map((k) => {
          const v = recordWithDates[k];
          if (v === null || v === undefined) return null;
          if (typeof v === "object") return JSON.stringify(v);
          return v;
        });
        const placeholders = cols.map(() => "?").join(", ");
        const idVal = record.id ?? null;
        await (await this.ensureDb()).runAsync(
          `INSERT OR REPLACE INTO ${storeName} (id, ${cols.join(", ")}) VALUES (?, ${placeholders})`,
          idVal,
          ...vals
        );
      }
    }
  }

  async delete(storeName: StoreName, id: number | string): Promise<void> {
    const col = storeName === "settings" || storeName === "files" || storeName === "meta" ? "key" : "id";
    await (await this.ensureDb()).runAsync(`DELETE FROM ${storeName} WHERE ${col} = ?`, id);
  }

  async storeFile(
    id: string,
    type: "music" | "video",
    blob: Blob,
    metadata?: { title?: string }
  ): Promise<string> {
    const ext = id.split(".").pop() || "bin";
    const fileName = `${type}_${Math.random().toString(36).slice(2)}.${ext}`;
    const filePath = FILE_DIR + fileName;

    const reader = new FileReader();
    const base64 = await new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    const base64Data = base64.split(",")[1];
    await FileSystem.writeAsStringAsync(filePath, base64Data, {
      encoding: FileSystem.EncodingType.Base64,
    });

    await (await this.ensureDb()).runAsync(
      `INSERT OR REPLACE INTO files (id, type, file_path, title, created_at) VALUES (?, ?, ?, ?, datetime('now'))`,
      id,
      type,
      filePath,
      metadata?.title || null
    );

    return filePath;
  }

  async getFile(id: string): Promise<{ id: string; file_path: string; type: string } | null> {
    return await (await this.ensureDb()).getFirstAsync<{
      id: string;
      file_path: string;
      type: string;
    }>("SELECT id, file_path, type FROM files WHERE id = ?", id);
  }

  async getFileByTitle(title: string): Promise<Music | null> {
    return await (await this.ensureDb()).getFirstAsync<Music>(
      `SELECT * FROM music WHERE title LIKE ? ORDER BY id DESC LIMIT 1`,
      `%${title}%`
    );
  }

  async getFilesByType(type: "music" | "video"): Promise<any[]> {
    return await (await this.ensureDb()).getAllAsync(
      "SELECT * FROM files WHERE type = ?",
      type
    );
  }

  async setMeta(key: string, value: string): Promise<void> {
    await (await this.ensureDb()).runAsync(
      `INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`,
      key,
      value
    );
  }

  async getMeta(key: string): Promise<string | null> {
    const row = await (await this.ensureDb()).getFirstAsync<{ value: string }>(
      "SELECT value FROM meta WHERE key = ?",
      key
    );
    return row?.value || null;
  }

  async clearAll(): Promise<void> {
    const tables: StoreName[] = [
      "users",
      "channels",
      "subscriptions",
      "videos",
      "music",
      "playlists",
      "settings",
      "files",
      "meta",
    ];
    for (const t of tables) {
      await (await this.ensureDb()).runAsync(`DELETE FROM ${t}`);
    }
    const dir = await FileSystem.getInfoAsync(FILE_DIR);
    if (dir.exists) {
      await FileSystem.deleteAsync(FILE_DIR, { idempotent: true });
      await FileSystem.makeDirectoryAsync(FILE_DIR, { intermediates: true });
    }
  }

  async hasLocalData(): Promise<boolean> {
    const vCount = await (await this.ensureDb()).getFirstAsync<{ c: number }>(
      "SELECT COUNT(*) as c FROM videos"
    );
    const mCount = await (await this.ensureDb()).getFirstAsync<{ c: number }>(
      "SELECT COUNT(*) as c FROM music"
    );
    return (vCount?.c ?? 0) > 0 || (mCount?.c ?? 0) > 0;
  }
}

export const localDb = new LocalDB();
