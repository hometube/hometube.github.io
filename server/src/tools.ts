// External-tool diagnostics mirrored from backend/services/ytdlp.tool_status().
import { existsSync } from "node:fs";

const JS_RUNTIMES = ["deno", "node", "bun", "quickjs"] as const;

export function which(cmd: string): string {
  const sep = process.platform === "win32" ? ";" : ":";
  const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of (process.env.PATH ?? "").split(sep)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = `${dir}/${cmd}${ext}`.replace(/\/+/g, "/");
      if (existsSync(p)) return p;
    }
  }
  return "";
}

// `yt-dlp --version` is a spawn, and GET /api/status is polled every couple
// of seconds, so cache it; invalidated when an update runs.
let ytdlpVersion: { at: number; v: string } | null = null;

export function ytDlpVersion(force = false): string {
  if (!force && ytdlpVersion && Date.now() - ytdlpVersion.at < 600_000) return ytdlpVersion.v;
  let v = "";
  try {
    const r = Bun.spawnSync([which("yt-dlp") || "yt-dlp", "--version"]);
    if (r.exitCode === 0) v = new TextDecoder().decode(r.stdout).trim();
  } catch {
    /* not runnable: reported as missing */
  }
  ytdlpVersion = { at: Date.now(), v };
  return v;
}

export function invalidateYtDlpVersion(): void {
  ytdlpVersion = null;
}

export function toolStatus(): { ffmpeg: string; js_runtime: string; yt_dlp: string; yt_dlp_version: string } {
  let js = "";
  for (const r of JS_RUNTIMES) {
    const hit = which(r);
    if (hit) {
      js = r;
      break;
    }
  }
  return { ffmpeg: which("ffmpeg"), js_runtime: js, yt_dlp: which("yt-dlp"), yt_dlp_version: ytDlpVersion() };
}
