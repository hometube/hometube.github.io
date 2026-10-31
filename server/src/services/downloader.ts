// Background download queue — port of backend/services/downloader.py.
// Python runs jobs on a 2-worker thread pool; JS runs them as async tasks
// with the same concurrency cap. The in-memory registry and job shapes match
// field-for-field so GET /api/downloads and client polling behave identically.
import type { Database } from "bun:sqlite";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { getSetting } from "../db";
import { downloadsDir } from "../paths";
import * as ytdlp from "./ytdlp";

export type JobType = "video" | "music";
export type JobStatus = "queued" | "running" | "done" | "error";

export interface Job {
  id: string;
  type: JobType;
  item_id: number;
  user_id: number | null;
  status: JobStatus;
  progress: number;
  message: string;
  created_at: string;
  quality?: string;
  filename?: string | null;
  error?: string | null;
}

const MAX_WORKERS = 2;

let _db: Database | null = null;
const _registry = new Map<string, Job>();
const _queue: string[] = [];
let _running = 0;

/** Background jobs outlive requests, so the queue keeps its own handle. */
export function initDownloader(db: Database): void {
  _db = db;
}

function dbHandle(): Database {
  if (!_db) throw new Error("downloader not initialized");
  return _db;
}

// Shape of Python's datetime.now(timezone.utc).isoformat().
function isoNow(): string {
  return new Date().toISOString().replace("Z", "000+00:00");
}

function newJobId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function write(jobId: string, fields: Partial<Job>): void {
  const job = _registry.get(jobId);
  if (job) Object.assign(job, fields);
}

function fetchItem(kind: JobType, itemId: number): { url: string; hint: string } | null {
  const table = kind === "video" ? "videos" : "music";
  const row = dbHandle()
    .query<{ url: string | null; video_id: string | null }, [number]>(
      `SELECT url, video_id FROM ${table} WHERE id = ?`,
    )
    .get(itemId);
  if (!row?.url) return null;
  // Extractor id names the produced file; fall back to the row id like
  // Python does when info.id is missing.
  return { url: row.url, hint: row.video_id || String(itemId) };
}

function applyToDb(kind: JobType, itemId: number, filename: string | null): void {
  if (!filename) throw new Error("Download finished but produced no file");
  const subdir = kind === "video" ? "videos" : "music";
  const path = join(downloadsDir(), subdir, filename);
  let size = 0;
  try {
    size = statSync(path).size;
  } catch {
    size = 0;
  }
  if (!existsSync(path) || size === 0) throw new Error(`Downloaded file is missing or empty: ${filename}`);
  const table = kind === "video" ? "videos" : "music";
  dbHandle().run(`UPDATE ${table} SET downloaded = 1, filename = ? WHERE id = ?`, [filename, itemId]);
}

function progressFor(jobId: string) {
  return (pct: number | null, msg: string): void => {
    write(jobId, pct == null ? { message: msg } : { progress: Math.trunc(pct), message: msg });
  };
}

async function run(jobId: string): Promise<void> {
  const job = _registry.get(jobId);
  if (!job) return;
  const { type: kind, item_id: itemId } = job;
  const quality = job.quality ?? "best";
  write(jobId, { status: "running", progress: 1, message: "Starting" });
  try {
    const item = fetchItem(kind, itemId);
    if (!item) throw new Error("Item no longer exists");
    const filename =
      kind === "video"
        ? await ytdlp.downloadVideoWithProgress(item.url, item.hint, quality, progressFor(jobId))
        : await ytdlp.downloadMusicWithProgress(item.url, item.hint, progressFor(jobId));
    applyToDb(kind, itemId, filename);
    write(jobId, { status: "done", progress: 100, message: "Done", filename });
  } catch (exc) {
    const msg = exc instanceof Error ? exc.message : String(exc);
    write(jobId, { status: "error", message: msg, error: msg });
  }
}

function pump(): void {
  while (_running < MAX_WORKERS && _queue.length) {
    const jobId = _queue.shift()!;
    _running++;
    run(jobId).finally(() => {
      _running--;
      pump();
    });
  }
}

export function startVideoDownload(videoId: number, userId: number | null, quality = "best"): string {
  return start("video", videoId, userId, quality);
}

export function startMusicDownload(musicId: number, userId: number | null): string {
  return start("music", musicId, userId);
}

/** Server setting `auto_download` (default on) toggles pre-downloading on add. */
export function autoDownloads(db: Database): boolean {
  const value = getSetting(db, "auto_download") ?? "1";
  return !["0", "false", "off", "no", ""].includes(value.trim().toLowerCase());
}

/** Queue only if the item isn't already downloaded and nothing is active. */
export function ensureDownload(kind: JobType, itemId: number, userId: number | null, quality?: string): string | null {
  if (activeFor(kind, itemId)) return null;
  const table = kind === "video" ? "videos" : "music";
  const row = dbHandle()
    .query<{ downloaded: number | null }, [number]>(`SELECT downloaded FROM ${table} WHERE id = ?`)
    .get(itemId);
  if (row?.downloaded) return null;
  return start(kind, itemId, userId, quality);
}

export function prewarm(kind: JobType, itemId: number, userId: number | null, quality?: string): string | null {
  if (!autoDownloads(dbHandle())) return null;
  return ensureDownload(kind, itemId, userId, quality);
}

function start(kind: JobType, itemId: number, userId: number | null, quality?: string): string {
  const id = newJobId();
  const job: Job = {
    id,
    type: kind,
    item_id: itemId,
    user_id: userId,
    status: "queued",
    progress: 0,
    message: "Queued",
    created_at: isoNow(),
  };
  if (quality !== undefined) job.quality = quality;
  _registry.set(id, job);
  _queue.push(id);
  pump();
  return id;
}

export function activeFor(kind: JobType, itemId: number): Job | null {
  for (const job of _registry.values()) {
    if (job.type === kind && job.item_id === itemId && (job.status === "queued" || job.status === "running")) {
      return { ...job };
    }
  }
  return null;
}

/** Resolve once a job for the item finishes; null when none exists. */
export async function waitFor(kind: JobType, itemId: number, timeoutMs = 1_800_000): Promise<Job | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let job: Job | undefined;
    for (const j of _registry.values()) {
      if (j.type === kind && j.item_id === itemId && ["queued", "running", "done", "error"].includes(j.status)) {
        job = j;
        break;
      }
    }
    if (!job || job.status === "done" || job.status === "error") return job ? { ...job } : null;
    if (Date.now() >= deadline) return activeFor(kind, itemId);
    await new Promise((r) => setTimeout(r, 500));
  }
}

export function listJobs(userId?: number | null): Job[] {
  let jobs = Array.from(_registry.values(), (j) => ({ filename: null, error: null, ...j }));
  if (userId != null) jobs = jobs.filter((j) => j.user_id === userId);
  jobs.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  return jobs;
}
