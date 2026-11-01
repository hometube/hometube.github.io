// yt-dlp wrapper — port of backend/services/ytdlp.py. The Python server uses
// yt-dlp's Python API (frozen-sidecar constraint); the JS server spawns the
// official `yt-dlp` binary instead, which is the same extraction engine.
// Same client exclusions, same format filtering, same thumbnail preference.
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { dataDir, downloadsDir } from "../paths";
import { getSetting, openDb } from "../db";
import { which, ytDlpVersion, invalidateYtDlpVersion } from "../tools";

const BASE_ARGS = ["--no-warnings", "--no-colors"];

// YouTube has been blocking the android_vr client (HTTP 403). Exclude it so
// yt-dlp uses the JS-capable web/web_safari clients instead. Overridable via
// the `player_client` setting: when YouTube breaks a client, users get an
// escape hatch without waiting for a new build.
export const DEFAULT_PLAYER_CLIENTS = "default,-android_vr";

// Per-call mutable config: cookies + player client, re-read from the settings
// table every ~10s so `ht settings set ...` (or the desktop Settings page)
// takes effect without a server restart and without reopening the DB per call.
//
// Cookie sources, first hit wins:
//   1. setting cookies_file  -> explicit Netscape cookies.txt path
//   2. <data_dir>/cookies.txt (drop a file, no restart needed)
//   3. setting cookies_browser -> e.g. "safari" | "chrome" | "firefox"
let configCache: { at: number; args: string[] } | null = null;

function readConfig(): { clients: string; cookies: string[] } {
  let clients = DEFAULT_PLAYER_CLIENTS;
  let cookies: string[] = [];
  try {
    const db = openDb();
    try {
      const pc = (getSetting(db, "player_client") || "").trim();
      if (pc) clients = pc;
      const file = (getSetting(db, "cookies_file") || "").trim() || join(dataDir(), "cookies.txt");
      const browser = (getSetting(db, "cookies_browser") || "").trim();
      if (existsSync(file)) cookies = ["--cookies", file];
      else if (browser) cookies = ["--cookies-from-browser", browser];
    } finally {
      db.close();
    }
  } catch {
    /* no DB available — anonymous mode */
  }
  return { clients, cookies };
}

export function resetYtdlpConfig(): void {
  configCache = null;
}

function baseArgs(): string[] {
  if (configCache && Date.now() - configCache.at < 10_000) return configCache.args;
  const { clients, cookies } = readConfig();
  const args = [...BASE_ARGS, "--extractor-args", `youtube:player_client=${clients}`, ...cookies];
  configCache = { at: Date.now(), args };
  return args;
}

// User-facing self-update for yt-dlp (the desktop equivalent of the yt-dlp
// half of `ht update`): upstream fixes extractor breakage in days, app
// releases take weeks. "nightly" opts into bleeding-edge fixes.
export async function updateYtDlp(
  channel: "stable" | "nightly" = "stable",
): Promise<{ ok: boolean; version?: string; error?: string }> {
  const args = channel === "nightly" ? ["--update-to", "nightly"] : ["-U"];
  let proc;
  try {
    proc = Bun.spawn([ytDlpPath(), ...args], { stdout: "pipe", stderr: "pipe" });
  } catch (e) {
    return { ok: false, error: `yt-dlp is not runnable: ${e}` };
  }
  const [out, errText] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  invalidateYtDlpVersion();
  const version = ytDlpVersion(true);
  if (proc.exitCode === 0) return { ok: true, version };
  const lines = `${out}\n${errText}`.trim().split("\n").filter(Boolean);
  return { ok: false, version, error: lines[lines.length - 1] || `yt-dlp exited with code ${proc.exitCode}` };
}

export function ytDlpPath(): string {
  return which("yt-dlp") || "yt-dlp";
}

export type Info = Record<string, any>;

async function runJson(extra: string[], url: string): Promise<Info | null> {
  const proc = Bun.spawn([ytDlpPath(), ...baseArgs(), "--quiet", "--no-progress", "-J", ...extra, url], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  if (proc.exitCode !== 0 || !out.trim()) return null;
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}

// Flat extraction: playlists/channels return lightweight entries, a plain
// video URL returns its info dict. Mirrors extract_flat=True.
export async function getVideoInfo(url: string): Promise<Info | null> {
  return runJson(["--flat-playlist"], url);
}

export async function getAvailableFormats(url: string): Promise<Info[]> {
  const data = await runJson([], url);
  const formats: Info[] = (data && data.formats) || [];
  const seen = new Set<number>();
  const result: Info[] = [];
  for (const f of formats) {
    if (f.vcodec === "none") continue;
    const height = f.height || 0;
    if (height > 0 && !seen.has(height)) {
      seen.add(height);
      result.push({
        format_id: f.format_id ?? null,
        height,
        ext: f.ext ?? null,
        note: f.format_note ?? "",
      });
    }
  }
  result.sort((a, b) => b.height - a.height);
  return result;
}

export async function getChannelVideos(url: string): Promise<Info[]> {
  const info = await runJson(["--flat-playlist", "--ignore-errors"], url);
  const entries = info && info.entries;
  if (!Array.isArray(entries)) return [];
  return entries.filter(Boolean);
}

export const getMusicInfo = getVideoInfo;

function isJpg(url: string): boolean {
  const path = url.split("?")[0].toLowerCase();
  return path.endsWith(".jpg") || path.endsWith(".jpeg");
}

/** Best album art URL: WebP art fails in several native image loaders, so
 * prefer the highest-preference .jpg thumbnail (yt-dlp orders ascending). */
export function pickAlbumArt(info: Info): string | null {
  const thumbs: Info[] = (info && info.thumbnails) || [];
  const jpgs = thumbs.filter((t) => t && typeof t.url === "string" && isJpg(t.url)).map((t) => t.url as string);
  if (jpgs.length) return jpgs[jpgs.length - 1];
  return (info && info.thumbnail) ?? null;
}

export const pickVideoThumbnail = pickAlbumArt;

type ProgressCb = ((pct: number, msg: string) => void) | undefined;

function fileReady(p: string): boolean {
  try {
    return statSync(p).size > 0;
  } catch {
    return false;
  }
}

// Newest ready file named `base.*` (preferred extension first), same idea as
// the Python glob fallback that resolves the stored filename after download.
// Image thumbnails (--write-thumbnail) land next to media files, so they are
// never valid results.
function newestFileMatching(dir: string, base: string, preferredExt?: string): string | null {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  const ready = names.filter(
    (n) => n.startsWith(`${base}.`) && !/\.(jpe?g|png|webp|gif)$/i.test(n) && fileReady(join(dir, n)),
  );
  if (!ready.length) return null;
  const exact = preferredExt ? ready.find((n) => n === `${base}.${preferredExt}`) : undefined;
  if (exact) return exact;
  ready.sort((a, b) => statSync(join(dir, a)).mtimeMs - statSync(join(dir, b)).mtimeMs);
  return ready[ready.length - 1];
}

function readLines(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void): Promise<void> {
  return new Promise((resolve) => {
    const reader = stream.getReader();
    const dec = new TextDecoder();
    let acc = "";
    const flush = (final: boolean): void => {
      let i: number;
      while ((i = acc.indexOf("\n")) >= 0) {
        onLine(acc.slice(0, i).replace(/\r$/, ""));
        acc = acc.slice(i + 1);
      }
      if (final && acc) {
        onLine(acc);
        acc = "";
      }
    };
    const pull = (): void => {
      reader.read().then(({ done, value }) => {
        if (done) {
          flush(true);
          resolve();
        } else {
          acc += dec.decode(value, { stream: true });
          flush(false);
          pull();
        }
      });
    };
    pull();
  });
}

// Spawn a downloading yt-dlp and derive progress from the `[download]`
// percent lines on stderr (--newline), like the Python progress_hooks did.
// The final file is discovered by globbing `idHint.*` in the out dir —
// idHint is the extractor id stored on the DB row.
// (yt-dlp's `--print` mode silences all progress output, hence globbing.)
async function runDownload(args: string[], url: string, onProgress: ProgressCb, kind: string): Promise<void> {
  const proc = Bun.spawn([ytDlpPath(), ...baseArgs(), "--newline", ...args, url], {
    stdout: "ignore",
    stderr: "pipe",
  });

  const errLines: string[] = [];
  await readLines(proc.stderr, (l) => {
    if (l.startsWith("ERROR!") || l.startsWith("ERROR:")) errLines.push(l);
    const m = /^\[download\]\s+([\d.]+)% of (.*)$/.exec(l);
    if (m && onProgress) {
      if (m[2].includes("~")) {
        onProgress(0, `Downloading ${kind} (unknown size)`);
      } else {
        const pct = Math.min(99, Math.floor(parseFloat(m[1])));
        onProgress(pct, `Downloading ${kind} ${pct}%`);
      }
    } else if (onProgress && /^\[(ExtractAudio|Merger|EmbedThumbnail|VideoConvertor|FFmpegExtractAudio|ThumbnailConvertor)\b/.test(l)) {
      onProgress(99, "Processing / merging");
    }
  });
  await proc.exited;

  if (proc.exitCode !== 0) {
    const msg = errLines[errLines.length - 1] || `yt-dlp exited with code ${proc.exitCode}`;
    throw new Error(msg.replace(/^ERROR!\s*/, ""));
  }
}

export async function downloadVideoWithProgress(
  url: string,
  idHint: string,
  quality = "best",
  onProgress?: ProgressCb,
): Promise<string> {
  const dir = join(downloadsDir(), "videos");
  mkdirSync(dir, { recursive: true });
  const fmt =
    quality !== "best" ? quality : "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best";
  await runDownload(["-f", fmt, "-o", join(dir, "%(id)s.%(ext)s"), url], url, onProgress, "video");
  onProgress?.(99, "Finalizing");
  const found = newestFileMatching(dir, idHint);
  if (!found) throw new Error(`No video file produced for ${url}`);
  return found;
}

export async function downloadMusicWithProgress(
  url: string,
  idHint: string,
  onProgress?: ProgressCb,
): Promise<string> {
  const dir = join(downloadsDir(), "music");
  mkdirSync(dir, { recursive: true });
  await runDownload(
    [
      "-o",
      join(dir, "%(id)s.%(ext)s"),
      "--extract-audio",
      "--audio-format",
      "mp3",
      "--audio-quality",
      "0",
      "--embed-thumbnail",
      "--convert-thumbnails",
      "jpg",
      "--write-thumbnail",
      url,
    ],
    url,
    onProgress,
    "music",
  );
  onProgress?.(99, "Finalizing");
  const found = newestFileMatching(dir, idHint, "mp3");
  if (!found) throw new Error(`No audio file produced for ${url}`);
  return found;
}

export const downloadVideo = (url: string, idHint: string, quality = "best") =>
  downloadVideoWithProgress(url, idHint, quality);
export const downloadMusic = (url: string, idHint: string) => downloadMusicWithProgress(url, idHint);
