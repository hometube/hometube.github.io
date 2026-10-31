// Slice 2 routes: videos, music, playlists (DB-only CRUD). The yt-dlp
// endpoints (add/info/download/qualities), podcasts and file serving follow
// in later slices. Response shapes mirror main.py exactly.
import type { Context, Hono } from "hono";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Env } from "../app";
import { serialize, type Row } from "../db";
import { fail } from "../errors";
import { downloadsDir } from "../paths";

type App = Hono<Env>;

const videosDir = () => join(downloadsDir(), "videos");
const musicDir = () => join(downloadsDir(), "music");

type Song = Record<string, unknown>;

async function body(c: Context<Env>): Promise<Record<string, unknown>> {
  try {
    return (await c.req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function getSongs(c: Context<Env>, playlistId: number): Song[] {
  const pl = c.env.db
    .query<{ songs: string | null }, [number]>("SELECT songs FROM playlists WHERE id = ?")
    .get(playlistId);
  if (!pl) fail(404, "Not Found");
  try {
    const parsed = JSON.parse(pl.songs ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function setSongs(c: Context<Env>, playlistId: number, songs: Song[]): void {
  c.env.db.run("UPDATE playlists SET songs = ? WHERE id = ?", [JSON.stringify(songs), playlistId]);
}

// Replaces the JSON membership list on every playlist, like delete_video /
// delete_music do on the ORM side (rows with NULL songs stay NULL).
function purgeFromPlaylists(c: Context<Env>, pred: (s: Song) => boolean): void {
  const rows = c.env.db
    .query<{ id: number; songs: string | null }, []>("SELECT id, songs FROM playlists")
    .all();
  for (const r of rows) {
    if (!r.songs) continue;
    let songs: Song[];
    try {
      songs = JSON.parse(r.songs);
    } catch {
      continue;
    }
    if (!Array.isArray(songs)) continue;
    const kept = songs.filter((s) => !pred(s));
    if (kept.length !== songs.length) {
      c.env.db.run("UPDATE playlists SET songs = ? WHERE id = ?", [JSON.stringify(kept), r.id]);
    }
  }
}

function removeIfExists(path: string): void {
  if (existsSync(path)) rmSync(path);
}

export function registerLibrary(app: App) {
  // ---- Videos ----
  app.get("/api/videos", (c) => {
    const userId = c.req.query("user_id");
    const filter = c.req.query("filter") ?? "all";
    const conds: string[] = [];
    const params: (string | number)[] = [];
    if (userId) {
      conds.push("added_by = ?");
      params.push(Number(userId));
    }
    if (filter === "unwatched") conds.push("watched_at IS NULL");
    if (filter === "keep") conds.push("keep_flag = 1");
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const rows = c.env.db
      .query<Row, (string | number)[]>(`SELECT * FROM videos ${where} ORDER BY created_at DESC`)
      .all(...params);
    return c.json(rows.map(serialize));
  });

  app.post("/api/videos/:id/watch", async (c) => {
    const id = Number(c.req.param("id"));
    const vid = c.env.db.query<Row, [number]>("SELECT * FROM videos WHERE id = ?").get(id);
    if (!vid) fail(404, "Not Found");
    const data = await body(c);
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    if (data.watched === true) {
      sets.push("watched_at = datetime('now')");
    } else if (data.watched === false) {
      sets.push("watched_at = NULL");
    }
    if (data.position != null) {
      sets.push("position = ?");
      params.push(Number(data.position));
    }
    if (sets.length) {
      c.env.db.run(`UPDATE videos SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
    }
    return c.json({ ok: true });
  });

  app.post("/api/videos/:id/keep", async (c) => {
    const id = Number(c.req.param("id"));
    if (!c.env.db.query("SELECT id FROM videos WHERE id = ?").get(id)) fail(404, "Not Found");
    const data = await body(c);
    const keep = data.keep === undefined ? true : Boolean(data.keep);
    c.env.db.run("UPDATE videos SET keep_flag = ? WHERE id = ?", [keep ? 1 : 0, id]);
    return c.json({ ok: true });
  });

  app.put("/api/videos/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!c.env.db.query("SELECT id FROM videos WHERE id = ?").get(id)) fail(404, "Not Found");
    const data = await body(c);
    if (data.channel_id != null) {
      if (!c.env.db.query("SELECT id FROM channels WHERE id = ?").get(Number(data.channel_id))) {
        fail(400, "Channel not found");
      }
    }
    if (data.added_by != null) {
      if (!c.env.db.query("SELECT id FROM users WHERE id = ?").get(Number(data.added_by))) {
        fail(400, "User not found");
      }
    }
    const sets: string[] = [];
    const params: (string | number)[] = [];
    for (const col of ["channel_id", "added_by", "thumbnail", "duration", "position", "quality"] as const) {
      if (data[col] != null) {
        sets.push(`${col} = ?`);
        params.push(data[col] as string | number);
      }
    }
    if (sets.length) {
      c.env.db.run(`UPDATE videos SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
    }
    return c.json(serialize(c.env.db.query<Row, [number]>("SELECT * FROM videos WHERE id = ?").get(id)!));
  });

  app.delete("/api/videos/:id", (c) => {
    const id = Number(c.req.param("id"));
    const vid = c.env.db.query<Row, [number]>("SELECT * FROM videos WHERE id = ?").get(id);
    if (!vid) fail(404, "Not Found");
    purgeFromPlaylists(c, (s) => s.type === "video" && s.video_id === id);
    if (vid.filename) {
      removeIfExists(join(videosDir(), String(vid.filename)));
    } else if (vid.video_id) {
      removeIfExists(join(videosDir(), `${vid.video_id}.mp4`));
    }
    c.env.db.run("DELETE FROM videos WHERE id = ?", [id]);
    return c.json({ ok: true });
  });

  // ---- Music ----
  app.get("/api/music", (c) => {
    const userId = c.req.query("user_id");
    const kind = c.req.query("kind");
    const conds: string[] = [];
    const params: (string | number)[] = [];
    if (userId) {
      conds.push("added_by = ?");
      params.push(Number(userId));
    }
    if (kind) {
      conds.push("kind = ?");
      params.push(kind);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const rows = c.env.db
      .query<Row, (string | number)[]>(`SELECT * FROM music ${where} ORDER BY created_at DESC`)
      .all(...params);
    return c.json(rows.map(serialize));
  });

  app.put("/api/music/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!c.env.db.query("SELECT id FROM music WHERE id = ?").get(id)) fail(404, "Not Found");
    const data = await body(c);
    if (data.added_by != null) {
      if (!c.env.db.query("SELECT id FROM users WHERE id = ?").get(Number(data.added_by))) {
        fail(400, "User not found");
      }
      c.env.db.run("UPDATE music SET added_by = ? WHERE id = ?", [Number(data.added_by), id]);
    }
    return c.json(serialize(c.env.db.query<Row, [number]>("SELECT * FROM music WHERE id = ?").get(id)!));
  });

  app.delete("/api/music/:id", (c) => {
    const id = Number(c.req.param("id"));
    const music = c.env.db.query<Row, [number]>("SELECT * FROM music WHERE id = ?").get(id);
    if (!music) fail(404, "Not Found");
    purgeFromPlaylists(c, (s) => s.music_id === id);
    if (music.filename) removeIfExists(join(musicDir(), String(music.filename)));
    c.env.db.run("DELETE FROM music WHERE id = ?", [id]);
    return c.json({ ok: true });
  });

  // ---- Playlists ----
  app.get("/api/playlists", (c) => {
    const userId = c.req.query("user_id");
    const kind = c.req.query("kind");
    const conds: string[] = [];
    const params: (string | number)[] = [];
    if (userId) {
      conds.push("user_id = ?");
      params.push(Number(userId));
    }
    if (kind) {
      conds.push("kind = ?");
      params.push(kind);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const rows = c.env.db
      .query<Row, (string | number)[]>(`SELECT * FROM playlists ${where} ORDER BY created_at DESC`)
      .all(...params);
    return c.json(rows.map(serialize));
  });

  app.post("/api/playlists", async (c) => {
    const data = await body(c);
    const kind = data.kind == null ? "music" : String(data.kind);
    const changes = c.env.db.run(
      "INSERT INTO playlists (name, user_id, kind, songs) VALUES (?, ?, ?, '[]')",
      [
        String(data.name ?? ""),
        data.user_id == null ? null : Number(data.user_id),
        kind,
      ],
    );
    const row = c.env.db
      .query<Row, [number]>("SELECT * FROM playlists WHERE id = ?")
      .get(Number(changes.lastInsertRowid))!;
    return c.json(serialize(row));
  });

  app.post("/api/playlists/:id/add", async (c) => {
    const id = Number(c.req.param("id"));
    if (!c.env.db.query("SELECT id FROM playlists WHERE id = ?").get(id)) fail(404, "Not Found");
    const data = await body(c);
    const songs = getSongs(c, id);
    const position = data.position == null ? 0 : Number(data.position);
    if (data.video_id != null) {
      const vidId = Number(data.video_id);
      if (!c.env.db.query("SELECT id FROM videos WHERE id = ?").get(vidId)) {
        fail(400, "Video not found");
      }
      songs.push({ video_id: vidId, position, type: "video" });
    } else {
      if (data.music_id == null) fail(400, "music_id or video_id required");
      // Python does not validate music existence here; parity.
      songs.push({ music_id: Number(data.music_id), position });
    }
    setSongs(c, id, songs);
    return c.json({ ok: true });
  });

  app.delete("/api/playlists/:id/remove/:item_id", (c) => {
    const id = Number(c.req.param("id"));
    const itemId = Number(c.req.param("item_id"));
    const itemType = c.req.query("item_type") ?? "music";
    if (!c.env.db.query("SELECT id FROM playlists WHERE id = ?").get(id)) fail(404, "Not Found");
    const songs = getSongs(c, id);
    const kept =
      itemType === "video"
        ? songs.filter((s) => !(s.type === "video" && s.video_id === itemId))
        : songs.filter((s) => s.music_id !== itemId);
    setSongs(c, id, kept);
    return c.json({ ok: true });
  });

  app.put("/api/playlists/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!c.env.db.query("SELECT id FROM playlists WHERE id = ?").get(id)) fail(404, "Not Found");
    const data = await body(c);
    if (data.user_id != null) {
      if (!c.env.db.query("SELECT id FROM users WHERE id = ?").get(Number(data.user_id))) {
        fail(400, "User not found");
      }
      c.env.db.run("UPDATE playlists SET user_id = ? WHERE id = ?", [Number(data.user_id), id]);
    }
    if (data.name != null) {
      c.env.db.run("UPDATE playlists SET name = ? WHERE id = ?", [String(data.name), id]);
    }
    if (data.songs != null) {
      c.env.db.run("UPDATE playlists SET songs = ? WHERE id = ?", [JSON.stringify(data.songs), id]);
    }
    return c.json(serialize(c.env.db.query<Row, [number]>("SELECT * FROM playlists WHERE id = ?").get(id)!));
  });

  app.delete("/api/playlists/:id", (c) => {
    const id = Number(c.req.param("id"));
    if (!c.env.db.query("SELECT id FROM playlists WHERE id = ?").get(id)) fail(404, "Not Found");
    c.env.db.run("DELETE FROM playlists WHERE id = ?", [id]);
    return c.json({ ok: true });
  });
}
