// Shared .ht import core used by both the HTTP route and the CLI. Remaps
// foreign ids onto freshly inserted rows per table, extracts media under the
// downloads dir, and runs as one transaction (rollback on any failure).
import type { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Row } from "./db";
import { downloadsDir } from "./paths";

// Column lists per table (id excluded on insert).
export const INSERT_COLS: Record<string, string[]> = {
  users: ["username"],
  channels: ["url", "name"],
  subscriptions: ["channel_id", "user_id", "criteria", "check_interval", "last_checked", "created_at", "kind"],
  videos: [
    "video_id", "title", "channel_id", "url", "downloaded", "added_by", "watched_at",
    "keep_flag", "quality", "created_at", "thumbnail", "filename", "position", "duration",
  ],
  music: [
    "video_id", "url", "title", "artist", "album_art", "filename", "is_playlist",
    "playlist_id", "downloaded", "added_by", "created_at", "kind", "channel_id", "duration",
  ],
  playlists: ["name", "user_id", "created_at", "songs", "kind"],
};

const BOOL_COLS = new Set(["downloaded", "keep_flag", "is_playlist"]);
const JSON_COLS = new Set(["criteria", "songs"]);
const DATE_COLS = new Set(["created_at", "watched_at", "last_checked"]);

// datetime.fromisoformat(...) -> SQLAlchemy's DATETIME bind format
// ("YYYY-MM-DD HH:MM:SS.ffffff", microseconds always 6 digits), so the
// SQLite string comparisons behave identically to Python's. Throws a plain
// Error like Python's ValueError: 500 on export, 400 inside import.
export function sqlDatetime(s: string): string {
  let out = s.replace("T", " ");
  if (/^\d{4}-\d{2}-\d{2}$/.test(out)) return `${out} 00:00:00.000000`;
  const frac = /\.(\d+)$/.exec(out);
  if (frac) {
    if (frac[1].length > 6) throw new Error(`Invalid isoformat string: '${s}'`);
    return out + "0".repeat(6 - frac[1].length);
  }
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(out)) return `${out}.000000`;
  throw new Error(`Invalid isoformat string: '${s}'`);
}

export interface ImportResult {
  summary: Record<string, number>;
  mediaExtracted: number;
}

/** Import parsed .ht metadata + zip entries. Throws on any failure after a
 * full rollback; callers format the user-facing message. `log` receives the
 * per-row progress lines the Python CLI printed. */
export function importHt(
  db: Database,
  metadata: Record<string, Row[]>,
  entries: Record<string, Uint8Array>,
  log?: (msg: string) => void,
): ImportResult {
  const summary: Record<string, number> = {
    users: 0,
    channels: 0,
    subscriptions: 0,
    videos: 0,
    music: 0,
    playlists: 0,
  };
  const idMap: Record<string, Record<number, number>> = {};
  let mediaExtracted = 0;

  const remap = (table: string, obj: Row, field: string) => {
    const v = obj[field];
    if (v && idMap[table] && Number(v) in idMap[table]) obj[field] = idMap[table][Number(v)];
  };

  const insert = (table: string, obj: Row): number => {
    const cols = INSERT_COLS[table];
    for (const k of Object.keys(obj)) {
      if (k === "id") continue;
      if (!cols.includes(k)) throw new Error(`unexpected column '${k}' for table '${table}'`);
    }
    const names: string[] = [];
    const vals: (string | number | null)[] = [];
    for (const col of cols) {
      let v = obj[col];
      if (v === undefined) v = null;
      if (v !== null) {
        if (BOOL_COLS.has(col)) v = v ? 1 : 0;
        else if (JSON_COLS.has(col)) v = JSON.stringify(v);
        else if (DATE_COLS.has(col) && typeof v === "string") v = sqlDatetime(v);
      }
      names.push(col);
      vals.push(v as string | number | null);
    }
    const changes = db.run(
      `INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
      vals,
    );
    return Number(changes.lastInsertRowid);
  };

  db.run("BEGIN IMMEDIATE");
  try {
    if (metadata.users) {
      idMap.users = {};
      for (const u of metadata.users) {
        const existing = db.query<Row, [string]>("SELECT * FROM users WHERE username = ?").get(String(u.username));
        if (existing) {
          idMap.users[Number(u.id)] = Number(existing.id);
          log?.(`  User '${u.username}' already exists (id ${existing.id}), skipped`);
          continue;
        }
        idMap.users[Number(u.id)] = insert("users", u);
        summary.users++;
        log?.(`  Imported user: ${u.username} (id ${idMap.users[Number(u.id)]})`);
      }
    }

    if (metadata.channels) {
      // No dedup here — Python always inserts fresh channel rows.
      idMap.channels = {};
      for (const ch of metadata.channels) {
        idMap.channels[Number(ch.id)] = insert("channels", ch);
        summary.channels++;
        log?.(`  Imported channel: ${ch.name || ch.url} (id ${idMap.channels[Number(ch.id)]})`);
      }
    }

    if (metadata.subscriptions) {
      idMap.subscriptions = {};
      for (const s of metadata.subscriptions) {
        remap("channels", s, "channel_id");
        remap("users", s, "user_id");
        idMap.subscriptions[Number(s.id)] = insert("subscriptions", s);
        summary.subscriptions++;
        log?.(`  Imported subscription (id ${idMap.subscriptions[Number(s.id)]})`);
      }
    }

    if (metadata.videos) {
      idMap.videos = {};
      for (const v of metadata.videos) {
        remap("channels", v, "channel_id");
        remap("users", v, "added_by");
        idMap.videos[Number(v.id)] = insert("videos", v);
        summary.videos++;
        log?.(`  Imported video: ${v.title} (id ${idMap.videos[Number(v.id)]})`);
      }
    }

    if (metadata.music) {
      idMap.music = {};
      for (const m of metadata.music) {
        remap("channels", m, "channel_id");
        remap("users", m, "added_by");
        idMap.music[Number(m.id)] = insert("music", m);
        summary.music++;
        log?.(`  Imported music: ${m.title} (id ${idMap.music[Number(m.id)]})`);
      }
    }

    if (metadata.playlists) {
      idMap.playlists = {};
      for (const p of metadata.playlists) {
        remap("users", p, "user_id");
        if (p.songs && Array.isArray(p.songs)) {
          p.songs = (p.songs as Row[]).map((song) => {
            const s = { ...song };
            remap("music", s, "music_id");
            remap("videos", s, "video_id");
            return s;
          });
        }
        idMap.playlists[Number(p.id)] = insert("playlists", p);
        summary.playlists++;
        log?.(`  Imported playlist: ${p.name} (id ${idMap.playlists[Number(p.id)]})`);
      }
    }

    // Extract media files (containment-checked — zip-slip guard, an
    // intentional hardening over Python's zf.extract).
    const root = downloadsDir();
    for (const [name, bytes] of Object.entries(entries)) {
      if (name.endsWith("/") || !(name.startsWith("videos/") || name.startsWith("music/"))) continue;
      const path = join(root, name);
      if (!path.startsWith(join(root, ""))) continue;
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, bytes);
      mediaExtracted++;
      log?.(`  Extracted ${name.startsWith("videos/") ? "video" : "music"}: ${name}`);
    }

    if (metadata.settings) {
      for (const s of metadata.settings) {
        if (s.key === "jwt_secret") continue;
        const existing = db.query<Row, [string]>('SELECT "key" FROM settings WHERE "key" = ?').get(String(s.key));
        if (!existing) {
          db.run('INSERT INTO settings ("key", value) VALUES (?, ?)', [
            String(s.key),
            s.value == null ? null : String(s.value),
          ]);
          log?.(`  Imported setting: ${s.key}`);
        }
      }
    }

    db.run("COMMIT");
  } catch (e) {
    try {
      db.run("ROLLBACK");
    } catch {
      /* no active transaction */
    }
    throw e;
  }

  return { summary, mediaExtracted };
}
