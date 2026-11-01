// Slice 3 routes: everything that touches yt-dlp — add video/music (incl.
// playlist bulk-add), info/qualities, download kickoff, channels. Response
// shapes mirror main.py; downloads run through the background job registry.
import type { Context, Hono } from "hono";
import type { Env } from "../app";
import { clearDownloadError, serialize, type Row } from "../db";
import { fail } from "../errors";
import * as ytdlp from "../services/ytdlp";
import * as downloader from "../services/downloader";

type App = Hono<Env>;

type Info = Record<string, any>;

async function body(c: Context<Env>): Promise<Record<string, unknown>> {
  try {
    return (await c.req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// Remove trailing "[video_id]" tag from titles, like Python clean_title.
function cleanTitle(title: unknown): string | null {
  if (title == null) return title as null;
  return String(title).replace(/\s*\[[^\]]+\]\s*$/, "");
}

function getOrCreateChannel(c: Context<Env>, url: string, name?: string | null): Row {
  let chan = c.env.db.query<Row, [string]>("SELECT * FROM channels WHERE url = ?").get(url);
  if (!chan && name) chan = c.env.db.query<Row, [string]>("SELECT * FROM channels WHERE name = ?").get(name);
  if (!chan) {
    const changes = c.env.db.run("INSERT INTO channels (url, name) VALUES (?, ?)", [url, name || ""]);
    chan = c.env.db.query<Row, [number]>("SELECT * FROM channels WHERE id = ?").get(Number(changes.lastInsertRowid))!;
  }
  return chan;
}

function resolveChannelFromInfo(c: Context<Env>, info: Info): Row | null {
  const url = info.channel_url || info.uploader_url;
  if (!url) return null;
  return getOrCreateChannel(c, url, info.channel || info.uploader);
}

function entryUrl(entry: Info): string {
  return entry.webpage_url || entry.url || `https://www.youtube.com/watch?v=${entry.id}`;
}

function appendSongs(c: Context<Env>, playlistId: number, entries: Record<string, unknown>[]): void {
  const row = c.env.db.query<{ songs: string | null }, [number]>("SELECT songs FROM playlists WHERE id = ?").get(playlistId);
  if (!row) return;
  let songs: Record<string, unknown>[] = [];
  try {
    songs = JSON.parse(row.songs ?? "[]");
  } catch {
    songs = [];
  }
  if (!Array.isArray(songs)) songs = [];
  c.env.db.run("UPDATE playlists SET songs = ? WHERE id = ?", [JSON.stringify([...songs, ...entries]), playlistId]);
}

function insertVideo(c: Context<Env>, fields: {
  video_id: string | null;
  title: string | null;
  url: string;
  added_by: number | null;
  quality: string;
  thumbnail: string | null;
  duration: number | null;
}): number {
  const changes = c.env.db.run(
    `INSERT INTO videos (video_id, title, url, thumbnail, duration, downloaded, added_by, keep_flag, quality)
     VALUES (?, ?, ?, ?, ?, 0, ?, 0, ?)`,
    [fields.video_id, fields.title, fields.url, fields.thumbnail, fields.duration, fields.added_by, fields.quality],
  );
  return Number(changes.lastInsertRowid);
}

function insertMusic(c: Context<Env>, fields: {
  video_id: string | null;
  url: string;
  title: string | null;
  artist: string | null;
  album_art: string | null;
  kind: string;
  channel_id: number | null;
  added_by: number | null;
}): number {
  const changes = c.env.db.run(
    `INSERT INTO music (video_id, url, title, artist, album_art, kind, channel_id, is_playlist, downloaded, added_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`,
    [fields.video_id, fields.url, fields.title, fields.artist, fields.album_art, fields.kind, fields.channel_id, fields.added_by],
  );
  return Number(changes.lastInsertRowid);
}

function createPlaylist(c: Context<Env>, name: string, userId: number | null, kind: string, songs: unknown[]): number {
  const changes = c.env.db.run("INSERT INTO playlists (name, user_id, kind, songs) VALUES (?, ?, ?, ?)", [
    name,
    userId,
    kind,
    JSON.stringify(songs),
  ]);
  return Number(changes.lastInsertRowid);
}

export function registerMedia(app: App) {
  // ---- Videos ----
  app.post("/api/videos/add", async (c) => {
    const data = await body(c);
    const info = await ytdlp.getVideoInfo(String(data.url ?? ""));
    if (!info) fail(400, "Invalid video URL");

    const userId = data.user_id == null ? null : Number(data.user_id);
    const quality = data.quality == null ? "best" : String(data.quality);

    if ("entries" in info) {
      const entries: Info[] = info.entries || [];
      if (!entries.length) fail(400, "Empty playlist");
      const videoIds: number[] = [];
      for (const entry of entries) {
        if (!entry || entry.id == null) continue;
        videoIds.push(
          insertVideo(c, {
            video_id: String(entry.id),
            title: entry.title || "Unknown",
            url: entryUrl(entry),
            added_by: userId,
            quality,
            thumbnail: ytdlp.pickVideoThumbnail(entry) || ytdlp.pickVideoThumbnail(info),
            duration: entry.duration ?? null,
          }),
        );
      }
      let playlistId: number;
      const targetPl = Number(data.playlist_id ?? 0);
      if (targetPl) {
        const pl = c.env.db.query("SELECT id FROM playlists WHERE id = ?").get(targetPl);
        // Python accesses playlist.id at return time, so a dangling
        // playlist_id crashes with a 500 there; mirror the status.
        if (!pl) fail(500, "Internal Server Error");
        appendSongs(
          c,
          targetPl,
          videoIds.map((video_id) => ({ video_id, position: 0, type: "video" })),
        );
        playlistId = targetPl;
      } else {
        playlistId = createPlaylist(
          c,
          String(info.title || "New Playlist").trim(),
          userId,
          "video",
          videoIds.map((video_id, i) => ({ video_id, position: i, type: "video" })),
        );
      }
      for (const vidId of videoIds) downloader.prewarm("video", vidId, userId, quality);
      return c.json({ ok: true, count: videoIds.length, is_playlist: true, playlist_id: playlistId });
    }

    const id = insertVideo(c, {
      video_id: info.id != null ? String(info.id) : null,
      title: info.title || "Unknown",
      url: String(data.url ?? ""),
      added_by: userId,
      quality,
      thumbnail: ytdlp.pickVideoThumbnail(info),
      duration: info.duration ?? null,
    });
    if (data.playlist_id != null) {
      const pl = c.env.db.query("SELECT id FROM playlists WHERE id = ?").get(Number(data.playlist_id));
      if (pl) appendSongs(c, Number(data.playlist_id), [{ video_id: id, position: 0, type: "video" }]);
    }
    downloader.prewarm("video", id, userId, quality);
    return c.json(serialize(c.env.db.query<Row, [number]>("SELECT * FROM videos WHERE id = ?").get(id)!));
  });

  app.get("/api/videos/info", async (c) => {
    const url = c.req.query("url");
    if (!url) return c.json({ detail: "url query param required" }, 422);
    return c.json(await ytdlp.getAvailableFormats(url));
  });

  app.get("/api/videos/:id/qualities", async (c) => {
    const vid = c.env.db
      .query<Row, [number]>("SELECT * FROM videos WHERE id = ?")
      .get(Number(c.req.param("id")));
    if (!vid) fail(404, "Not Found");
    return c.json(await ytdlp.getAvailableFormats(String(vid.url ?? "")));
  });

  app.post("/api/videos/:id/download", async (c) => {
    const vid = c.env.db
      .query<Row, [number]>("SELECT * FROM videos WHERE id = ?")
      .get(Number(c.req.param("id")));
    if (!vid) fail(404, "Not Found");
    // Explicit retry: drop any remembered failure so this attempt goes out.
    clearDownloadError(c.env.db, "video", Number(vid.id));
    const active = downloader.activeFor("video", Number(vid.id));
    if (active) {
      return c.json({ ok: true, job_id: active.id, queued: true }, 202);
    }
    const data = await body(c);
    const quality = data.quality != null ? String(data.quality) : (vid.quality as string) || "best";
    const jobId = downloader.startVideoDownload(Number(vid.id), vid.added_by as number | null, quality);
    return c.json({ ok: true, job_id: jobId, queued: false }, 202);
  });

  // ---- Music ----
  app.get("/api/music/info", async (c) => {
    const url = c.req.query("url");
    if (!url) return c.json({ detail: "url query param required" }, 422);
    const info = await ytdlp.getMusicInfo(url);
    return c.json(info ?? null);
  });

  app.post("/api/music/add", async (c) => {
    const data = await body(c);
    const info = await ytdlp.getMusicInfo(String(data.url ?? ""));
    if (!info) fail(400, "Invalid music URL");

    const kind = data.kind == null ? "music" : String(data.kind);
    const isPodcast = kind === "podcast";
    const userId = data.user_id == null ? null : Number(data.user_id);
    const channelId = data.channel_id == null ? null : Number(data.channel_id);

    if ("entries" in info) {
      const entries: Info[] = info.entries || [];
      if (!entries.length) fail(400, "Empty playlist");
      const channel = isPodcast && channelId == null ? resolveChannelFromInfo(c, info) : null;
      const musicIds: number[] = [];
      for (const entry of entries) {
        if (!entry || entry.id == null) continue;
        const entryChannel = channel || (isPodcast ? resolveChannelFromInfo(c, entry) : null);
        musicIds.push(
          insertMusic(c, {
            video_id: String(entry.id),
            url: entryUrl(entry),
            title: cleanTitle(entry.title ?? "Unknown"),
            artist: entry.artist || entry.channel || entry.uploader || null,
            album_art: ytdlp.pickAlbumArt(entry) || ytdlp.pickAlbumArt(info),
            kind,
            channel_id: channelId ?? (entryChannel ? Number(entryChannel.id) : null),
            added_by: userId,
          }),
        );
      }
      let playlistId: number;
      const targetPl = Number(data.playlist_id ?? 0);
      if (targetPl) {
        const pl = c.env.db.query("SELECT id FROM playlists WHERE id = ?").get(targetPl);
        if (!pl) fail(500, "Internal Server Error");
        appendSongs(
          c,
          targetPl,
          musicIds.map((music_id) => ({ music_id, position: 0 })),
        );
        playlistId = targetPl;
      } else {
        playlistId = createPlaylist(
          c,
          String(info.title || "New Playlist").trim(),
          userId,
          kind,
          musicIds.map((music_id, i) => ({ music_id, position: i })),
        );
      }
      for (const mid of musicIds) downloader.prewarm("music", mid, userId);
      return c.json({ ok: true, count: musicIds.length, is_playlist: true, playlist_id: playlistId });
    }

    const channel = isPodcast && channelId == null ? resolveChannelFromInfo(c, info) : null;
    const id = insertMusic(c, {
      video_id: info.id != null ? String(info.id) : null,
      url: String(data.url ?? ""),
      title: cleanTitle(info.title ?? null),
      artist: info.artist || info.channel || info.uploader || null,
      album_art: ytdlp.pickAlbumArt(info),
      kind,
      channel_id: channelId ?? (channel ? Number(channel.id) : null),
      added_by: userId,
    });
    if (data.playlist_id != null) {
      const pl = c.env.db.query("SELECT id FROM playlists WHERE id = ?").get(Number(data.playlist_id));
      if (pl) appendSongs(c, Number(data.playlist_id), [{ music_id: id, position: 0 }]);
    }
    downloader.prewarm("music", id, userId);
    return c.json(serialize(c.env.db.query<Row, [number]>("SELECT * FROM music WHERE id = ?").get(id)!));
  });

  app.post("/api/music/:id/download", async (c) => {
    const music = c.env.db
      .query<Row, [number]>("SELECT * FROM music WHERE id = ?")
      .get(Number(c.req.param("id")));
    if (!music) fail(404, "Not Found");
    // Explicit retry: drop any remembered failure so this attempt goes out.
    clearDownloadError(c.env.db, "music", Number(music.id));
    const active = downloader.activeFor("music", Number(music.id));
    if (active) {
      return c.json({ ok: true, job_id: active.id, queued: true }, 202);
    }
    const jobId = downloader.startMusicDownload(Number(music.id), music.added_by as number | null);
    return c.json({ ok: true, job_id: jobId, queued: false }, 202);
  });

  // ---- Channels ----
  app.post("/api/channels/add", async (c) => {
    const data = await body(c);
    const url = String(data.url ?? "");
    const info = await ytdlp.getVideoInfo(url);
    if (!info) fail(400, "Invalid channel URL");
    const changes = c.env.db.run("INSERT INTO channels (url, name) VALUES (?, ?)", [url, info.title ?? ""]);
    return c.json(
      serialize(c.env.db.query<Row, [number]>("SELECT * FROM channels WHERE id = ?").get(Number(changes.lastInsertRowid))!),
    );
  });

  app.get("/api/channels/:id/videos", async (c) => {
    const chan = c.env.db
      .query<Row, [number]>("SELECT * FROM channels WHERE id = ?")
      .get(Number(c.req.param("id")));
    if (!chan) fail(404, "Not Found");
    return c.json(await ytdlp.getChannelVideos(String(chan.url ?? "")));
  });

  app.post("/api/channels/:id/subscribe", async (c) => {
    const data = await body(c);
    c.env.db.run(
      "INSERT INTO subscriptions (channel_id, user_id, criteria, check_interval) VALUES (?, ?, ?, ?)",
      [
        Number(c.req.param("id")),
        data.user_id == null ? null : Number(data.user_id),
        JSON.stringify(data.criteria ?? {}),
        data.check_interval == null ? 3600 : Number(data.check_interval),
      ],
    );
    return c.json({ ok: true });
  });
}
