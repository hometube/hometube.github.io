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

export function toolStatus(): { ffmpeg: string; js_runtime: string } {
  let js = "";
  for (const r of JS_RUNTIMES) {
    const hit = which(r);
    if (hit) {
      js = r;
      break;
    }
  }
  return { ffmpeg: which("ffmpeg"), js_runtime: js };
}
