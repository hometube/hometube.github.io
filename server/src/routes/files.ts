// Slice 5 routes: media file serving. Static /api/files/* plus the lazy
// by-id endpoints that auto-download on first play, single-flight waiting on
// running jobs, and fall back to filename discovery — mirroring main.py.
// Responses use Bun.file bodies, which get native HTTP Range (206) support
// from Bun.serve, matching Starlette's FileResponse.
import { closeSync, existsSync, openSync, readSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Context, Hono } from "hono";
import type { Env } from "../app";
import { fail } from "../errors";
import { clearDownloadError, getDownloadError, setDownloadError, type Row } from "../db";
import { downloadsDir } from "../paths";
import * as ytdlp from "../services/ytdlp";
import * as downloader from "../services/downloader";

type App = Hono<Env>;

const VIDEO_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mkv: "video/x-matroska",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  flv: "video/x-flv",
  "3gp": "video/3gpp",
  mpeg: "video/mpeg",
};

const AUDIO_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  opus: "audio/opus",
  webm: "audio/webm",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  flac: "audio/flac",
  wav: "audio/wav",
};

const NO_CACHE = {
  "cache-control": "no-cache, no-store, must-revalidate",
  pragma: "no-cache",
  expires: "0",
};

const videosDir = () => join(downloadsDir(), "videos");
const musicDir = () => join(downloadsDir(), "music");

function extOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : "";
}

function baseHeaders(filename: string, mediaType: string, noCache: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": mediaType,
    "content-disposition": `attachment; filename="${filename}"`,
    "accept-ranges": "bytes",
  };
  if (noCache) Object.assign(headers, NO_CACHE);
  return headers;
}

// Starlette FileResponse semantics: valid range -> 206 with content-range,
// unsatisfiable start -> 416, malformed header -> whole file as 200.
// (Bun.serve's automatic Range support is lost when Hono re-wraps responses,
// so slicing is explicit here.)
function mediaResponse(c: Context<Env>, path: string, filename: string, mediaType: string, noCache: boolean): Response {
  const headers = baseHeaders(filename, mediaType, noCache);
  const file = Bun.file(path);
  const size = file.size;
  const raw = c.req.header("range");
  if (!raw) return new Response(file, { headers });
  const m = /^bytes=(\d*)-(\d*)$/.exec(raw.trim());
  if (!m || (!m[1] && !m[2])) return new Response(file, { headers });
  let start: number;
  let end: number;
  if (!m[1]) {
    const len = Number(m[2]);
    if (!len) return new Response(file, { headers });
    start = Math.max(0, size - len);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Number(m[2]) : size - 1;
    if (start >= size || start < 0) {
      return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    }
    if (end >= size) end = size - 1;
    if (end < start) return new Response(file, { headers });
  }
  // Buffer the slice via node:fs before responding: hono/cors rebuilds
  // responses, and a re-wrapped BunFile loses its slice window (sends the
  // whole file); Bun 1.1.15's BunFile.slice().arrayBuffer() has the same bug,
  // and stream bodies drop content-length. A plain ArrayBuffer body survives
  // all of it and keeps byte counts exact like Starlette.
  const buf = new Uint8Array(end - start + 1);
  {
    const fh = openSync(path, "r");
    try {
      readSync(fh, buf, 0, buf.byteLength, start);
    } finally {
      closeSync(fh);
    }
  }
  return new Response(buf, {
    status: 206,
    headers: { ...headers, "content-length": String(end - start + 1), "content-range": `bytes ${start}-${end}/${size}` },
  });
}

// Python's os.path.join(dir, filename:path) has no traversal guard; keep the
// containment check here (documented intentional divergence — a malicious
// path yields 404 instead of serving outside the downloads dir).
function resolveInside(dir: string, filename: string): string | null {
  const path = join(dir, filename);
  const root = join(dir, "");
  if (!path.startsWith(root) && path !== dir) return null;
  return path;
}

function exists(p: string | null): p is string {
  return !!p && existsSync(p);
}

function firstGlobLike(dir: string, needle: string): string | null {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  // Sidecar thumbnails are never valid media results.
  const hit = names.find((n) => n.includes(needle) && !/\.(jpe?g|png|webp|gif)$/i.test(n));
  return hit ?? null;
}

function reloadVideo(c: Context<Env>, id: number): Row {
  return c.env.db.query<Row, [number]>("SELECT * FROM videos WHERE id = ?").get(id)!;
}

function reloadMusic(c: Context<Env>, id: number): Row {
  return c.env.db.query<Row, [number]>("SELECT * FROM music WHERE id = ?").get(id)!;
}

function needsMediaDownload(row: Row, dir: string): boolean {
  return !row.downloaded || !row.filename || !existsSync(join(dir, String(row.filename)));
}

export function registerFiles(app: App) {
  // ---- Static file paths ----
  app.get("/api/files/videos/*", (c) => {
    const rel = decodeURIComponent(c.req.path.slice("/api/files/videos/".length));
    const path = resolveInside(videosDir(), rel);
    if (!exists(path)) fail(404, "Not Found");
    return mediaResponse(c, path, path.split("/").pop()!, VIDEO_TYPES[extOf(path)] ?? "video/mp4", false);
  });

  app.get("/api/files/music/*", (c) => {
    const rel = decodeURIComponent(c.req.path.slice("/api/files/music/".length));
    const path = resolveInside(musicDir(), rel);
    if (!exists(path)) fail(404, "Not Found");
    return mediaResponse(c, path, path.split("/").pop()!, AUDIO_TYPES[extOf(path)] ?? "audio/mpeg", false);
  });

  // ---- Lazy by-id paths ----
  app.get("/api/videos/:id/file", async (c) => {
    const id = Number(c.req.param("id"));
    let vid = c.env.db.query<Row, [number]>("SELECT * FROM videos WHERE id = ?").get(id);
    if (!vid) fail(404, "Not Found");
    const dir = videosDir();

    // Auto-download on first play; wait for a running background job rather
    // than starting a duplicate. Known-failed tracks fail fast (no repeated
    // YouTube round-trips) until retried or successfully downloaded.
    if (needsMediaDownload(vid, dir)) {
      const active = downloader.activeFor("video", id);
      if (active) {
        const done = await downloader.waitFor("video", id);
        if (done && done.status === "error") fail(500, `Download failed: ${done.error}`);
        vid = reloadVideo(c, id);
      }
      if (needsMediaDownload(vid!, dir)) {
        if (c.req.query("retry") === "1") clearDownloadError(c.env.db, "video", id);
        else {
          const cached = getDownloadError(c.env.db, "video", id);
          if (cached) fail(502, cached);
        }
        const hint = vid!.video_id ? String(vid!.video_id) : String(id);
        try {
          const filename = await ytdlp.downloadVideo(
            String(vid!.url ?? ""),
            hint,
            (vid!.quality as string) || "best",
          );
          c.env.db.run("UPDATE videos SET filename = ?, downloaded = 1 WHERE id = ?", [filename, id]);
          clearDownloadError(c.env.db, "video", id);
        } catch (exc) {
          const msg = `Download failed: ${exc instanceof Error ? exc.message : String(exc)}`;
          setDownloadError(c.env.db, "video", id, msg);
          fail(502, msg);
        }
        vid = reloadVideo(c, id);
      }
    }

    if (vid!.filename) {
      const path = join(dir, String(vid!.filename));
      if (existsSync(path)) {
        return mediaResponse(c, path, String(vid!.filename), VIDEO_TYPES[extOf(path)] ?? "video/mp4", true);
      }
    }

    // Fallback: find any file matching the video_id.
    const hint = vid!.video_id ? String(vid!.video_id) : String(id);
    const match = firstGlobLike(dir, hint);
    if (!match) fail(404, "Not Found");
    c.env.db.run("UPDATE videos SET filename = ? WHERE id = ?", [match, id]);
    const path = join(dir, match);
    if (existsSync(path)) return mediaResponse(c, path, match, VIDEO_TYPES[extOf(path)] ?? "video/mp4", true);
    fail(404, "Not Found");
  });

  app.get("/api/music/:id/file", async (c) => {
    const id = Number(c.req.param("id"));
    let music = c.env.db.query<Row, [number]>("SELECT * FROM music WHERE id = ?").get(id);
    if (!music) fail(404, "Not Found");
    const dir = musicDir();

    // Auto-download / wait-for-job, same single-flight pattern as videos.
    // Known-failed tracks fail fast until retried (?retry=1) or fixed.
    if (needsMediaDownload(music, dir)) {
      const active = downloader.activeFor("music", id);
      if (active) {
        const done = await downloader.waitFor("music", id);
        if (done && done.status === "error") fail(500, `Download failed: ${done.error}`);
        music = reloadMusic(c, id);
      }
      if (needsMediaDownload(music!, dir)) {
        if (c.req.query("retry") === "1") clearDownloadError(c.env.db, "music", id);
        else {
          const cached = getDownloadError(c.env.db, "music", id);
          if (cached) fail(502, cached);
        }
        const hint = music!.video_id ? String(music!.video_id) : String(id);
        try {
          const filename = await ytdlp.downloadMusic(String(music!.url ?? ""), hint);
          c.env.db.run("UPDATE music SET filename = ?, downloaded = 1 WHERE id = ?", [filename, id]);
          clearDownloadError(c.env.db, "music", id);
        } catch (exc) {
          const msg = `Download failed: ${exc instanceof Error ? exc.message : String(exc)}`;
          setDownloadError(c.env.db, "music", id, msg);
          fail(502, msg);
        }
        music = reloadMusic(c, id);
      }
    }

    // Stored filename first.
    if (music!.filename) {
      const path = join(dir, String(music!.filename));
      if (existsSync(path)) {
        return mediaResponse(c, path, String(music!.filename), AUDIO_TYPES[extOf(path)] ?? "audio/mpeg", true);
      }
    }

    // Imported files carry their name in a file:// URL.
    const url = music!.url ? String(music!.url) : "";
    if (url.startsWith("file://")) {
      const filename = url.slice(7);
      const path = join(dir, filename);
      if (existsSync(path)) {
        c.env.db.run("UPDATE music SET filename = ? WHERE id = ?", [filename, id]);
        return mediaResponse(c, path, filename, AUDIO_TYPES[extOf(path)] ?? "audio/mpeg", true);
      }
    }

    // Find file by video_id — falling back to URL ?v=/youtu.be, then the
    // "[video_id]" tag in the title, then the row id.
    let videoId = music!.video_id ? String(music!.video_id) : "";
    if (!videoId && url) {
      const m = /[?&]v=([^&]+)/.exec(url) || /youtu\.be\/([^?&]+)/.exec(url);
      if (m) videoId = m[1];
    }
    if (!videoId && music!.title) {
      const m = /\[([^\]]+)\]/.exec(String(music!.title));
      if (m) videoId = m[1];
    }
    if (!videoId) videoId = String(id);

    const match = firstGlobLike(dir, videoId);
    if (!match) fail(404, "Not Found");
    c.env.db.run("UPDATE music SET filename = ? WHERE id = ?", [match, id]);
    const path = join(dir, match);
    return mediaResponse(c, path, match, AUDIO_TYPES[extOf(path)] ?? "audio/mpeg", true);
  });
}
