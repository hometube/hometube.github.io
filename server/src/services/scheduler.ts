// Background subscription checker + auto-delete — port of
// backend/services/scheduler.py. Python runs it as an asyncio task ticking
// every 60s; same rhythm here, first pass immediately after boot.
import type { Database } from "bun:sqlite";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { downloadsDir } from "../paths";
import type { Row } from "../db";
import * as ytdlp from "./ytdlp";
import * as downloader from "./downloader";

let _db: Database | null = null;
let _timer: ReturnType<typeof setInterval> | null = null;

export function initScheduler(db: Database): void {
  _db = db;
}

function dbHandle(): Database {
  if (!_db) throw new Error("scheduler not initialized");
  return _db;
}

// SQLite DATETIME columns hold naive UTC ("YYYY-MM-DD HH:MM:SS.ffffff") —
// Python wrote these with datetime.utcnow(), so keep 6 fractional digits.
export function naiveNow(): string {
  return `${new Date().toISOString().replace("T", " ").replace("Z", "")}000`;
}

function parseNaiveUtc(s: string): number {
  const iso = s.includes("T") ? s : s.replace(" ", "T");
  const t = Date.parse(iso.endsWith("Z") ? iso : `${iso}Z`);
  return Number.isNaN(t) ? 0 : t;
}

// Mirrors Python's timedelta.seconds (total seconds mod 86400), quirks and
// all, so skip-windows behave identically.
function elapsedSecondsSince(tsMs: number): number {
  return Math.max(0, Math.floor((Date.now() - tsMs) / 1000)) % 86400;
}

function parseJsonCol(v: unknown): Record<string, any> {
  if (typeof v !== "string") return {};
  try {
    const p = JSON.parse(v);
    return p && typeof p === "object" ? p : {};
  } catch {
    return {};
  }
}

function entryUrl(entry: Row): string {
  return String(entry.webpage_url || entry.url || `https://www.youtube.com/watch?v=${entry.id}`);
}

function matchesCriteria(criteria: Record<string, any>, title: string, duration: number): boolean {
  const keywords: string[] = criteria.keywords || [];
  if (keywords.length && !keywords.some((k) => title.toLowerCase().includes(String(k).toLowerCase()))) {
    return false;
  }
  if (criteria.min_length && duration < criteria.min_length) return false;
  if (criteria.max_length && duration > criteria.max_length) return false;
  return true;
}

export async function checkOnce(): Promise<void> {
  const db = dbHandle();
  const newVideoIds: { id: number; user_id: number | null }[] = [];
  const newEpisodeIds: { id: number; user_id: number | null }[] = [];

  const subs = db.query<Row, []>("SELECT * FROM subscriptions").all();
  for (const sub of subs) {
    const interval = Number(sub.check_interval ?? 0);
    if (sub.last_checked && Number.isFinite(interval) && interval > 0) {
      if (elapsedSecondsSince(parseNaiveUtc(String(sub.last_checked))) < interval) continue;
    }
    const channel = db
      .query<Row, [number]>("SELECT * FROM channels WHERE id = ?")
      .get(Number(sub.channel_id));
    if (!channel) continue;
    const isPodcast = String(sub.kind ?? "video") === "podcast";
    const entries = await ytdlp.getChannelVideos(String(channel.url ?? ""));
    const criteria = parseJsonCol(sub.criteria);
    for (const v of entries) {
      if (!v || v.id == null) continue;
      const vId = String(v.id);
      const exists = isPodcast
        ? db.query("SELECT id FROM music WHERE kind = 'podcast' AND video_id = ?").get(vId)
        : db.query("SELECT id FROM videos WHERE video_id = ?").get(vId);
      if (exists) continue;
      const title = String(v.title ?? "");
      const duration = Number(v.duration ?? 0);
      if (!matchesCriteria(criteria, title, duration)) continue;
      if (isPodcast) {
        const changes = db.run(
          `INSERT INTO music (video_id, title, channel_id, url, artist, album_art, is_playlist, downloaded, added_by, kind)
           VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, 'podcast')`,
          [
            vId,
            title,
            Number(channel.id),
            entryUrl(v),
            channel.name == null ? null : String(channel.name),
            ytdlp.pickAlbumArt(v),
            sub.user_id == null ? null : Number(sub.user_id),
          ],
        );
        newEpisodeIds.push({ id: Number(changes.lastInsertRowid), user_id: sub.user_id == null ? null : Number(sub.user_id) });
      } else {
        const changes = db.run(
          `INSERT INTO videos (video_id, title, channel_id, url, thumbnail, duration, downloaded, added_by, keep_flag, quality)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0, ?)`,
          [
            vId,
            title,
            Number(channel.id),
            v.url == null ? null : String(v.url),
            ytdlp.pickAlbumArt(v),
            v.duration == null ? null : Number(v.duration),
            sub.user_id == null ? null : Number(sub.user_id),
            criteria.quality ?? "best",
          ],
        );
        newVideoIds.push({ id: Number(changes.lastInsertRowid), user_id: sub.user_id == null ? null : Number(sub.user_id) });
      }
    }
    db.run("UPDATE subscriptions SET last_checked = ? WHERE id = ?", [naiveNow(), Number(sub.id)]);
  }

  // Pre-warm newly-detected subscription items (auto_download setting).
  if (downloader.autoDownloads(db)) {
    for (const { id, user_id } of newVideoIds) downloader.ensureDownload("video", id, user_id);
    for (const { id, user_id } of newEpisodeIds) downloader.ensureDownload("music", id, user_id);
  }

  // Auto-delete videos watched >7 days ago without the keep flag.
  const cutoff = new Date(Date.now() - 7 * 86400_000).toISOString().replace("T", " ").replace("Z", "000");
  const stale = db
    .query<Row, [string]>(
      "SELECT * FROM videos WHERE watched_at IS NOT NULL AND watched_at < ? AND keep_flag = 0",
    )
    .all(cutoff);
  for (const vid of stale) {
    const name = String(vid.filename || `${vid.video_id}.mp4`);
    const path = join(downloadsDir(), "videos", name);
    if (existsSync(path)) rmSync(path);
    db.run("DELETE FROM videos WHERE id = ?", [Number(vid.id)]);
  }
}

/** Returns the number of episodes added — shared with the podcast routes
 * (Python: main.backfill_podcast_episodes, limit=100). */
export async function backfillPodcastEpisodes(
  channel: Row,
  userId: number | null,
  criteriaIn?: Record<string, any> | null,
  limit = 100,
): Promise<number> {
  const db = dbHandle();
  const entries = (await ytdlp.getChannelVideos(String(channel.url ?? ""))).slice(0, limit);
  const criteria = criteriaIn || {};
  let count = 0;
  const newIds: number[] = [];
  for (const entry of entries) {
    if (!entry || entry.id == null) continue;
    const vId = String(entry.id);
    if (db.query("SELECT id FROM music WHERE kind = 'podcast' AND video_id = ?").get(vId)) continue;
    const title = String(entry.title || "Unknown");
    const duration = Number(entry.duration || 0);
    // Backfill only filters on duration when the entry actually has one.
    const keywords: string[] = criteria.keywords || [];
    if (keywords.length && !keywords.some((k) => title.toLowerCase().includes(String(k).toLowerCase()))) {
      continue;
    }
    if (criteria.min_length && duration && duration < criteria.min_length) continue;
    if (criteria.max_length && duration && duration > criteria.max_length) continue;
    const changes = db.run(
      `INSERT INTO music (video_id, url, title, artist, album_art, is_playlist, downloaded, added_by, kind, channel_id)
       VALUES (?, ?, ?, ?, ?, 0, 0, ?, 'podcast', ?)`,
      [
        vId,
        entryUrl(entry),
        title.replace(/\s*\[[^\]]+\]\s*$/, ""),
        channel.name == null ? null : String(channel.name),
        ytdlp.pickAlbumArt(entry),
        userId,
        Number(channel.id),
      ],
    );
    newIds.push(Number(changes.lastInsertRowid));
    count++;
  }
  // Pre-warm only the newest few so the latest plays instantly without
  // mass-downloading the whole backlog.
  for (const epId of newIds.slice(0, 3)) downloader.prewarm("music", epId, userId);
  return count;
}

export function startScheduler(intervalMs = 60_000): void {
  const tick = () => {
    checkOnce().catch((e) => console.error("[scheduler]", e instanceof Error ? e.message : e));
  };
  tick(); // Python's asyncio task runs its first pass immediately
  _timer = setInterval(tick, intervalMs);
  _timer.unref?.();
}

export function stopScheduler(): void {
  if (_timer) clearInterval(_timer);
  _timer = null;
}
