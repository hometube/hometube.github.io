// Slice 6 routes: .ht export/import. Zip layout and metadata shape mirror
// main.py exactly: metadata.json (version 2, serialized rows per table) plus
// videos/ and music/ media files. FKs are remapped through old_id -> new_id
// tables on import; settings never overwrite existing keys and jwt_secret is
// skipped so importing another instance's backup cannot break auth.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { strToU8, unzipSync, zipSync } from "fflate";
import type { Context, Hono } from "hono";
import type { Env } from "../app";
import { serialize, type Row } from "../db";
import { fail, HttpError } from "../errors";
import { downloadsDir } from "../paths";

type App = Hono<Env>;

// Column lists per table (id excluded on insert; export uses SELECT * order,
// which matches SQLAlchemy's __table__.columns).
const INSERT_COLS: Record<string, string[]> = {
  users: ["username"],
  channels: ["url", "name"],
  subscriptions: ["channel_id", "user_id", "criteria", "check_interval", "last_checked", "created_at", "kind"],
  videos: [
    "video_id", "title", "channel_id", "url", "downloaded", "added_by", "watched_at",
    "keep_flag", "quality", "created_at", "thumbnail", "filename", "position", "duration",
  ],
  music: [
    "video_id", "url", "title", "artist", "album_art", "filename", "is_playlist",
    "playlist_id", "downloaded", "added_by", "created_at", "kind", "channel_id",
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
function sqlDatetime(s: string): string {
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

// datetime.utcnow().isoformat() — microseconds, no Z.
function utcNowIso(): string {
  return new Date().toISOString().replace("Z", "");
}

function exportFilename(): string {
  const s = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `hometube-export-${s}.ht`;
}

interface ExportBody {
  type?: string;
  user_id?: number | null;
  date_from?: string | null;
  date_to?: string | null;
  video_ids?: number[] | null;
  music_ids?: number[] | null;
}

function mediaRows(
  c: Context<Env>,
  table: "videos" | "music",
  data: ExportBody,
  kind: "videos" | "music",
): Row[] {
  // type gate: videos rows only for "videos"/"all", music rows only for
  // "music"/"all" (Python's q.filter(False) branch yields nothing).
  const wanted = kind === "videos" ? data.type === "videos" || data.type === "all" : data.type === "music" || data.type === "all";
  if (!wanted) return [];
  const conds: string[] = [];
  const params: (string | number)[] = [];
  if (data.user_id) {
    conds.push("added_by = ?");
    params.push(Number(data.user_id));
  }
  const ids = kind === "videos" ? data.video_ids : data.music_ids;
  if (ids && ids.length) {
    conds.push(`id IN (${ids.map(() => "?").join(",")})`);
    params.push(...ids.map(Number));
  }
  if (data.date_from) {
    conds.push("created_at >= ?");
    params.push(sqlDatetime(String(data.date_from)));
  }
  if (data.date_to) {
    conds.push("created_at <= ?");
    params.push(sqlDatetime(String(data.date_to)));
  }
  const where = conds.length ? ` WHERE ${conds.join(" AND ")}` : "";
  return c.env.db.query<Row, (string | number)[]>(`SELECT * FROM ${table}${where}`).all(...params);
}

function userScoped(
  c: Context<Env>,
  table: string,
  column: string | null,
  userId: number | null | undefined,
): Row[] {
  if (column && userId) {
    return c.env.db
      .query<Row, [number]>(`SELECT * FROM ${table} WHERE ${column} = ?`)
      .all(Number(userId));
  }
  return c.env.db.query<Row, []>(`SELECT * FROM ${table}`).all();
}

export function registerExportImport(app: App) {
  app.post("/api/export", async (c) => {
    // FastAPI uses body defaults for a missing/invalid JSON body; mirror {}.
    const data = ((await c.req.json().catch(() => ({}))) as ExportBody) ?? {};
    const userId = data.user_id == null ? null : Number(data.user_id);
    const type = data.type ?? "all";

    const videos = mediaRows(c, "videos", { ...data, type }, "videos").map(serialize);
    const music = mediaRows(c, "music", { ...data, type }, "music").map(serialize);
    const metadata: Record<string, unknown> = {
      version: 2,
      exported_at: utcNowIso(),
      users: userScoped(c, "users", "id", userId).map(serialize),
      channels: userScoped(c, "channels", null, null).map(serialize),
      subscriptions: userScoped(c, "subscriptions", "user_id", userId).map(serialize),
      videos,
      music,
      playlists: userScoped(c, "playlists", "user_id", userId).map(serialize),
      settings: userScoped(c, "settings", null, null).map(serialize),
    };

    const entries: Record<string, Uint8Array> = {
      "metadata.json": strToU8(JSON.stringify(metadata, null, 2)),
    };
    const vDir = join(downloadsDir(), "videos");
    const mDir = join(downloadsDir(), "music");
    for (const v of videos) {
      if (!(v.downloaded && (v.filename || v.video_id))) continue;
      const fname = String(v.filename || `${v.video_id}.mp4`);
      const path = join(vDir, fname);
      if (existsSync(path)) entries[`videos/${fname}`] = new Uint8Array(readFileSync(path));
    }
    for (const m of music) {
      if (!m.filename) continue;
      const path = join(mDir, String(m.filename));
      if (existsSync(path)) entries[`music/${m.filename}`] = new Uint8Array(readFileSync(path));
    }

    const bytes = zipSync(entries);
    return new Response(bytes, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${exportFilename()}"`,
      },
    });
  });

  app.post("/api/import", async (c) => {
    const form = await c.req.parseBody();
    const file = form.file;
    if (!(file instanceof File) || !String(file.name ?? "").endsWith(".ht")) {
      fail(400, "File must have .ht extension");
    }
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
    } catch (e) {
      fail(400, `Import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!entries["metadata.json"]) fail(400, "Invalid .ht file: missing metadata.json");
    let metadata: Record<string, Row[]>;
    try {
      metadata = JSON.parse(new TextDecoder().decode(entries["metadata.json"]));
    } catch (e) {
      fail(400, `Import failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    const db = c.env.db;
    const summary: Record<string, number> = {
      users: 0,
      channels: 0,
      subscriptions: 0,
      videos: 0,
      music: 0,
      playlists: 0,
    };
    const idMap: Record<string, Record<number, number>> = {};

    const remap = (table: string, obj: Row, field: string) => {
      const v = obj[field];
      if (v && idMap[table] && Number(v) in idMap[table]) obj[field] = idMap[table][Number(v)];
    };

    const insert = (table: string, obj: Row): number => {
      const cols = INSERT_COLS[table];
      for (const k of Object.keys(obj)) {
        if (k === "id") continue;
        if (!cols.includes(k)) fail(400, `Import failed: unexpected column '${k}' for table '${table}'`);
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

    try {
      db.run("BEGIN IMMEDIATE");

      if (metadata.users) {
        idMap.users = {};
        for (const u of metadata.users) {
          const existing = db
            .query<Row, [string]>("SELECT * FROM users WHERE username = ?")
            .get(String(u.username));
          if (existing) {
            idMap.users[Number(u.id)] = Number(existing.id);
            continue;
          }
          idMap.users[Number(u.id)] = insert("users", u);
          summary.users++;
        }
      }

      if (metadata.channels) {
        // No dedup here — Python always inserts fresh channel rows.
        idMap.channels = {};
        for (const ch of metadata.channels) {
          idMap.channels[Number(ch.id)] = insert("channels", ch);
          summary.channels++;
        }
      }

      if (metadata.subscriptions) {
        idMap.subscriptions = {};
        for (const s of metadata.subscriptions) {
          remap("channels", s, "channel_id");
          remap("users", s, "user_id");
          idMap.subscriptions[Number(s.id)] = insert("subscriptions", s);
          summary.subscriptions++;
        }
      }

      if (metadata.videos) {
        idMap.videos = {};
        for (const v of metadata.videos) {
          remap("channels", v, "channel_id");
          remap("users", v, "added_by");
          idMap.videos[Number(v.id)] = insert("videos", v);
          summary.videos++;
        }
      }

      if (metadata.music) {
        idMap.music = {};
        for (const m of metadata.music) {
          remap("channels", m, "channel_id");
          remap("users", m, "added_by");
          idMap.music[Number(m.id)] = insert("music", m);
          summary.music++;
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
      }

      if (metadata.settings) {
        for (const s of metadata.settings) {
          if (s.key === "jwt_secret") continue;
          const existing = db
            .query<Row, [string]>('SELECT "key" FROM settings WHERE "key" = ?')
            .get(String(s.key));
          if (!existing) {
            db.run('INSERT INTO settings ("key", value) VALUES (?, ?)', [String(s.key), s.value == null ? null : String(s.value)]);
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
      if (e instanceof HttpError) fail(e.status, e.message);
      fail(400, `Import failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    return c.json({ ok: true, summary });
  });
}
