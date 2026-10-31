// Path resolution — mirrors backend/paths.py so both servers (and the CLI)
// share one data dir: env override -> ~/.config/hometube/config.json -> ./data
import { homedir } from "os";
import { join, resolve } from "path";
import { existsSync, readFileSync } from "fs";

const CONFIG_FILE = join(homedir(), ".config", "hometube", "config.json");

export function loadConfig(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return {};
  }
}

// Finder/GUI launches get a minimal PATH without Homebrew/winget dirs, so
// ffmpeg and JS runtimes stay invisible to downloads. Prepend the standard
// install locations (idempotent). Mirrors paths.ensure_tool_path().
export function ensureToolPath(): void {
  let candidates: string[];
  if (process.platform === "darwin") {
    candidates = ["/opt/homebrew/bin", "/usr/local/bin"];
  } else if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? "";
    candidates = [
      local ? join(local, "Microsoft", "WinGet", "Links") : "",
      "C:\\ProgramData\\chocolatey\\bin",
    ];
  } else {
    candidates = ["/usr/local/bin", join(homedir(), ".local", "bin")];
  }
  const dirs = (process.env.PATH ?? "").split(delimiter());
  const add = candidates.filter((c) => c && !dirs.includes(c) && existsSync(c));
  if (add.length) process.env.PATH = [...add, ...dirs].join(delimiter());
}

const delimiter = () => (process.platform === "win32" ? ";" : ":");

export function dataDir(): string {
  const d = process.env.DATA_DIR || (loadConfig().data_dir as string) || "data";
  return resolve(d);
}

export function dbPath(): string {
  return process.env.DB_PATH || join(dataDir(), "db.sqlite");
}

export function downloadsDir(): string {
  return process.env.DL_DIR || join(dataDir(), "downloads");
}
