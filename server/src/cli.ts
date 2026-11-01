#!/usr/bin/env bun
// HomeTube CLI (JS port of backend/cli.py) — manage a HomeTube instance from
// the terminal. Same config file, same data dir, same database as the server.
//
//   ht install | init | login | download | export | import | songs |
//   playlists | videos | podcasts | settings | update | serve | pair |
//   mobile | build-server | fixart | fixaudio
import { Database } from "bun:sqlite";
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync,
  renameSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { strToU8, unzipSync, zipSync } from "fflate";
import { openDb, serialize, type Row } from "./db";
import { loadConfig, saveConfig, downloadsDir, ensureToolPath } from "./paths";
import { issuePairingToken, lanIp } from "./auth";
import { importHt } from "./hts";
import * as ytdlp from "./services/ytdlp";

ensureToolPath();

const SERVER_DIR = dirname(import.meta.dir); // .../server
const REPO_ROOT = dirname(SERVER_DIR);

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function die(msg: string, code = 1): never {
  console.error(msg);
  process.exit(code);
}

function which(name: string): string | null {
  const probe = process.platform === "win32" ? "where" : "which";
  const r = Bun.spawnSync([probe, name], { stdout: "pipe", stderr: "ignore" });
  const out = r.stdout?.toString().trim().split(/\r?\n/)[0];
  return r.exitCode === 0 && out ? out : null;
}

function run(cmd: string[], opts: { cwd?: string; quiet?: boolean } = {}): number {
  const proc = Bun.spawnSync(cmd, {
    cwd: opts.cwd,
    stdout: opts.quiet ? "ignore" : "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  return proc.exitCode ?? 1;
}

function runOut(cmd: string[], cwd?: string): string {
  const r = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "ignore" });
  return r.stdout?.toString() ?? "";
}

// node vs Bun DOM type clash on ReadableStreamDefaultReader — keep it loose.
let stdinReader: { read: () => Promise<{ done: boolean; value?: Uint8Array }> } | null = null;
let stdinBuf = "";
async function ask(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  const reader = (stdinReader ??= (Bun.stdin.stream() as ReadableStream<Uint8Array>).getReader());
  const decoder = new TextDecoder();
  for (;;) {
    const idx = stdinBuf.indexOf("\n");
    if (idx >= 0) {
      const line = stdinBuf.slice(0, idx);
      stdinBuf = stdinBuf.slice(idx + 1);
      return line.replace(/\r$/, "").trim();
    }
    const { done, value } = await reader.read();
    if (done) return stdinBuf.trim();
    stdinBuf += decoder.decode(value ?? new Uint8Array(), { stream: true });
  }
}

function printTable(rows: unknown[][], headers: string[]): void {
  if (!rows.length) {
    console.log("No results.");
    return;
  }
  const cell = (v: unknown) => (v == null ? "" : String(v));
  const widths = headers.map((h) => h.length);
  for (const row of rows) {
    row.forEach((c, i) => (widths[i] = Math.max(widths[i], cell(c).length)));
  }
  const headerLine = headers.map((h, i) => h.padEnd(widths[i])).join("  ");
  console.log(headerLine);
  console.log("-".repeat(headerLine.length));
  for (const row of rows) console.log(row.map((c, i) => cell(c).padEnd(widths[i])).join("  "));
}

function naiveNow(): string {
  return `${new Date().toISOString().replace("T", " ").replace("Z", "")}000`;
}

function cleanTitle(title: string | null): string | null {
  return title ? title.replace(/\s*\[[^\]]+\]\s*$/, "") : title;
}

// datetime.utcnow() formatted like Python's strftime("%Y%m%d-%H%M%S").
function utcStamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}

// ---------------------------------------------------------------------------
// Flag parsing (keeps the exact user-facing surface of argparse)
// ---------------------------------------------------------------------------

type Spec = Record<string, { alias?: string; value?: boolean }>;

function parseFlags(argv: string[], spec: Spec): { flags: Record<string, string | boolean>; positional: string[] } {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  const byName = new Map<string, { key: string; value?: boolean }>();
  for (const [key, s] of Object.entries(spec)) {
    byName.set(`--${key}`, { key, value: s.value });
    if (s.alias) byName.set(s.alias, { key, value: s.value });
  }
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok.startsWith("-") && tok !== "-") {
      const hit = byName.get(tok);
      if (!hit) die(`ht: error: unrecognized arguments: ${tok}`, 2);
      if (hit.value) {
        const v = argv[++i];
        if (v === undefined) die(`ht: error: argument ${tok}: expected one argument`, 2);
        flags[hit.key] = v;
      } else {
        flags[hit.key] = true;
      }
    } else {
      positional.push(tok);
    }
  }
  return { flags, positional };
}

const s = (f: Record<string, string | boolean>, k: string): string | null =>
  typeof f[k] === "string" ? (f[k] as string) : null;
const b = (f: Record<string, string | boolean>, k: string): boolean => f[k] === true;

// ---------------------------------------------------------------------------
// DB conveniences
// ---------------------------------------------------------------------------

function activeUser(db: Database): Row | null {
  const username = loadConfig().active_user;
  if (!username) return null;
  return db.query<Row, [string]>("SELECT * FROM users WHERE username = ?").get(String(username));
}

function requireUser(db: Database): Row {
  const user = activeUser(db);
  if (!user) die("Error: No active user. Use 'ht login <username>' first.", 1);
  return user;
}

function getSongs(db: Database, playlistId: number): Row[] {
  const row = db.query<{ songs: string | null }, [number]>("SELECT songs FROM playlists WHERE id = ?").get(playlistId);
  try {
    const parsed = row?.songs ? JSON.parse(row.songs) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function setSongs(db: Database, playlistId: number, songs: Row[]): void {
  db.run("UPDATE playlists SET songs = ? WHERE id = ?", [JSON.stringify(songs), playlistId]);
}

function resolvePlaylist(db: Database, userId: number, idOrName: string): Row | null {
  const pk = Number(idOrName);
  if (Number.isInteger(pk) && idOrName.trim() !== "") {
    return db.query<Row, [number, number]>("SELECT * FROM playlists WHERE id = ? AND user_id = ?").get(pk, userId);
  }
  return db.query<Row, [string, number]>("SELECT * FROM playlists WHERE name = ? AND user_id = ?").get(idOrName, userId);
}

function resolveMusic(db: Database, userId: number, idOrName: string): Row | null {
  const pk = Number(idOrName);
  if (Number.isInteger(pk) && idOrName.trim() !== "") {
    return db.query<Row, [number, number]>("SELECT * FROM music WHERE id = ? AND added_by = ?").get(pk, userId);
  }
  return db.query<Row, [string, number]>("SELECT * FROM music WHERE title LIKE ? AND added_by = ?").get(idOrName, userId);
}

function resolveVideo(db: Database, userId: number, idOrName: string): Row | null {
  const pk = Number(idOrName);
  if (Number.isInteger(pk) && idOrName.trim() !== "") {
    return db.query<Row, [number, number]>("SELECT * FROM videos WHERE id = ? AND added_by = ?").get(pk, userId);
  }
  return db.query<Row, [string, number]>("SELECT * FROM videos WHERE title LIKE ? AND added_by = ?").get(idOrName, userId);
}

const dateStr = (v: unknown): string => (typeof v === "string" ? v.slice(0, 10) : "");

// ---------------------------------------------------------------------------
// Tool checks (mirrors check_ytdlp / check_ffmpeg)
// ---------------------------------------------------------------------------

function checkFfmpeg(): boolean {
  if (which("ffmpeg")) return true;
  console.error("Warning: ffmpeg not found. Music downloads need it to convert and");
  console.error("  embed cover art. Install it with:");
  console.error("    brew install ffmpeg          # macOS");
  console.error("    sudo apt install ffmpeg      # Linux");
  console.error("    winget install Gyan.FFmpeg   # Windows");
  return false;
}

function checkYtdlp(): boolean {
  if (!which("yt-dlp")) {
    console.log("Warning: yt-dlp not found. Install it with:");
    console.log("  brew install yt-dlp          # macOS");
    console.log("  sudo apt install yt-dlp      # Linux");
    console.log("  winget install yt-dlp.yt-dlp # Windows");
    console.log();
    return false;
  }
  checkFfmpeg();
  return true;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdInstall(): Promise<void> {
  const binDir = join(homedir(), ".local", "bin");
  mkdirSync(binDir, { recursive: true });
  const bunBin = process.execPath;
  const cliPath = join(SERVER_DIR, "src", "cli.ts");

  if (process.platform === "win32") {
    const htPath = join(binDir, "ht.cmd");
    writeFileSync(htPath, `@echo off\r\n"${bunBin}" "${cliPath}" %*\r\n`);
    console.log(`Installed ht to ${htPath}`);
    // Append to the user PATH via the registry (PowerShell), like winreg did.
    const cur = runOut(["powershell", "-NoProfile", "-Command", "[Environment]::GetEnvironmentVariable('Path','User')"]).trim();
    const parts = cur.split(";").filter(Boolean);
    if (!parts.some((p) => p.toLowerCase() === binDir.toLowerCase())) {
      const next = [...parts, binDir].join(";").replace(/'/g, "''");
      run(["powershell", "-NoProfile", "-Command", `[Environment]::SetEnvironmentVariable('Path', '${next}', 'User')`], { quiet: true });
      console.log(`  Added ${binDir} to your user PATH. Restart your terminal to use it.`);
    } else {
      console.log(`Make sure ${binDir} is in your PATH.`);
    }
  } else {
    const htPath = join(binDir, "ht");
    writeFileSync(htPath, `#!/bin/sh\nexec "${bunBin}" "${cliPath}" "$@"\n`);
    chmodSync(htPath, 0o755);
    console.log(`Installed ht to ${htPath}`);
    console.log(`Make sure ${binDir} is in your PATH:`);
    console.log(`  export PATH="$PATH:${binDir}"`);
  }
  console.log();
  checkYtdlp();
}

async function cmdInit(): Promise<void> {
  const config = loadConfig();
  console.log("HomeTube Setup\n");

  const defData = (config.data_dir as string) || join(process.cwd(), "data");
  const data = await ask(`Data directory [${defData}]: `);
  config.data_dir = data || defData;

  const username = await ask(`Default username [${config.active_user ?? ""}]: `);
  if (username) config.active_user = username;
  saveConfig(config);

  if (username) {
    const db = openDb();
    if (!db.query("SELECT id FROM users WHERE username = ?").get(username)) {
      db.run("INSERT INTO users (username) VALUES (?)", [username]);
      console.log(`Created user: ${username}`);
    }
    db.close();
  }

  console.log("\nSetup complete!");
  console.log(`  Data directory: ${config.data_dir}`);
  console.log(`  Default user: ${config.active_user ?? "(none)"}`);
}

async function cmdLogin(username: string, yes: boolean): Promise<void> {
  const db = openDb();
  let user = db.query("SELECT id FROM users WHERE username = ?").get(username);
  if (!user) {
    let create = yes;
    if (!create) {
      const resp = (await ask(`User '${username}' does not exist. Create? [Y/n]: `)).toLowerCase();
      create = resp !== "n";
    }
    if (!create) {
      console.log("Aborted.");
      return;
    }
    db.run("INSERT INTO users (username) VALUES (?)", [username]);
    console.log(`Created user: ${username}`);
  }
  const config = loadConfig();
  config.active_user = username;
  saveConfig(config);
  console.log(`Switched to user: ${username}`);
}

function resolveMusicChannel(db: Database, info: ytdlp.Info): Row | null {
  const chUrl = (info.channel_url as string) || (info.uploader_url as string);
  if (!chUrl) return null;
  let channel = db.query<Row, [string]>("SELECT * FROM channels WHERE url = ?").get(chUrl);
  if (!channel) {
    const changes = db.run("INSERT INTO channels (url, name) VALUES (?, ?)", [
      chUrl,
      (info.channel as string) || (info.uploader as string) || "",
    ]);
    channel = db.query<Row, [number]>("SELECT * FROM channels WHERE id = ?").get(Number(changes.lastInsertRowid))!;
  }
  return channel;
}

async function cmdDownload(url: string, flags: Record<string, string | boolean>): Promise<void> {
  if (!checkYtdlp()) process.exit(1);
  const type = s(flags, "type");
  const playlistName = s(flags, "playlist");
  const quality = s(flags, "quality") ?? "best";
  const doDownload = !b(flags, "no-download"); // default on, like argparse

  const db = openDb();
  const user = requireUser(db);

  console.log(`Fetching info for: ${url}`);
  const info = await ytdlp.getVideoInfo(url);
  if (!info) die("Error: Could not fetch URL info", 1);

  const entriesIn = Array.isArray(info.entries) ? (info.entries as ytdlp.Info[]) : null;
  const isPlaylist = Boolean(entriesIn && entriesIn.length);

  if (isPlaylist) {
    const entries = entriesIn!.filter((e) => e && e.id);
    if (!entries.length) die("Error: Empty playlist", 1);
    const isYtmusic = url.includes("music.youtube.com");
    const contentType =
      type || (isYtmusic || entries[0].artist || entries[0].album || entries[0].track ? "music" : "video");

    if (contentType === "video") {
      console.log(`Adding ${entries.length} videos...`);
      const createdIds: number[] = [];
      for (const entry of entries) {
        const entryUrl = (entry.webpage_url as string) || (entry.url as string) || `https://www.youtube.com/watch?v=${entry.id}`;
        const existing = db.query<Row, [string]>("SELECT * FROM videos WHERE video_id = ?").get(String(entry.id));
        const title = String(entry.title ?? entry.id);
        if (existing) {
          console.log(`  Exists: ${title}`);
          createdIds.push(Number(existing.id));
          continue;
        }
        const changes = db.run(
          `INSERT INTO videos (video_id, title, url, thumbnail, duration, added_by, quality)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            String(entry.id),
            title,
            entryUrl,
            ytdlp.pickVideoThumbnail(entry) ?? ytdlp.pickVideoThumbnail(info),
            entry.duration == null ? null : Number(entry.duration),
            Number(user.id),
            quality,
          ],
        );
        const id = Number(changes.lastInsertRowid);
        createdIds.push(id);
        console.log(`  Added: ${title}`);
        if (doDownload) {
          try {
            const filename = await ytdlp.downloadVideo(entryUrl, String(id), quality);
            db.run("UPDATE videos SET filename = ?, downloaded = 1 WHERE id = ?", [filename, id]);
            console.log(`  Downloaded: ${title}`);
          } catch (exc) {
            console.error(`  Download failed: ${title}: ${exc instanceof Error ? exc.message : String(exc)}`);
          }
        }
      }
      if (createdIds.length && playlistName) {
        let pl = db
          .query<Row, [string, number]>("SELECT * FROM playlists WHERE name = ? AND user_id = ? AND kind = 'video'")
          .get(playlistName, Number(user.id));
        if (!pl) {
          const changes = db.run("INSERT INTO playlists (name, user_id, kind, songs) VALUES (?, ?, 'video', '[]')", [
            playlistName,
            Number(user.id),
          ]);
          pl = db.query<Row, [number]>("SELECT * FROM playlists WHERE id = ?").get(Number(changes.lastInsertRowid))!;
        }
        const songs = getSongs(db, Number(pl.id));
        const existingIds = new Set(songs.filter((x) => x.type === "video").map((x) => Number(x.video_id)));
        for (const cid of createdIds) {
          if (existingIds.has(cid)) continue;
          songs.push({ video_id: cid, position: songs.length, type: "video" });
        }
        setSongs(db, Number(pl.id), songs);
        console.log(`Saved to video playlist: ${pl.name}`);
      }
      console.log(`\nAdded ${entries.length} videos.`);
      return;
    }

    // music / podcast playlist
    const kind = contentType === "podcast" ? "podcast" : "music";
    const plName = playlistName || String(info.title ?? "").trim() || "New Playlist";
    const plConds = ["name = ?", "user_id = ?"];
    const plParams: (string | number)[] = [plName, Number(user.id)];
    if (kind === "podcast") plConds.push("kind = 'podcast'");
    let playlist = db
      .query<Row, (string | number)[]>(`SELECT * FROM playlists WHERE ${plConds.join(" AND ")}`)
      .get(...plParams);
    if (!playlist) {
      const changes = db.run("INSERT INTO playlists (name, user_id, kind, songs) VALUES (?, ?, ?, '[]')", [
        plName,
        Number(user.id),
        kind,
      ]);
      playlist = db.query<Row, [number]>("SELECT * FROM playlists WHERE id = ?").get(Number(changes.lastInsertRowid))!;
      console.log(`Created playlist: ${playlist.name}`);
    } else {
      console.log(`Adding to playlist: ${playlist.name}`);
    }

    const channel = kind === "podcast" ? resolveMusicChannel(db, info) : null;
    console.log(`${doDownload ? "Downloading" : "Adding"} ${entries.length} tracks...`);
    for (const entry of entries) {
      if (!entry.id) continue;
      const title = cleanTitle(String(entry.title ?? "Unknown"))!;
      const artist = (entry.artist as string) || (entry.channel as string) || (entry.uploader as string) || null;
      const albumArt = ytdlp.pickAlbumArt(entry) ?? ytdlp.pickAlbumArt(info);
      const entryUrl = (entry.webpage_url as string) || (entry.url as string) || `https://www.youtube.com/watch?v=${entry.id}`;
      const existing = db.query<Row, [string]>("SELECT * FROM music WHERE video_id = ?").get(String(entry.id));
      if (existing) {
        if (doDownload && !existing.downloaded) {
          try {
            const filename = await ytdlp.downloadMusic(String(existing.url || entryUrl), String(existing.id));
            db.run("UPDATE music SET filename = ?, downloaded = 1 WHERE id = ?", [filename, Number(existing.id)]);
            console.log(`  Downloaded: ${title}`);
          } catch (exc) {
            console.error(`  Download failed: ${title}: ${exc instanceof Error ? exc.message : String(exc)}`);
          }
        }
        const songs = getSongs(db, Number(playlist.id));
        const playlistIds = songs.map((x) => Number(x.music_id));
        if (!playlistIds.includes(Number(existing.id))) {
          songs.push({ music_id: Number(existing.id), position: songs.length });
          setSongs(db, Number(playlist.id), songs);
          console.log(`  Added existing: ${title}`);
        } else {
          console.log(`  Already in playlist: ${title}`);
        }
        continue;
      }
      let entryChannel = channel;
      if (entryChannel === null && kind === "podcast") entryChannel = resolveMusicChannel(db, entry);
      const changes = db.run(
        `INSERT INTO music (video_id, url, title, artist, album_art, added_by, kind, channel_id, duration)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          String(entry.id),
          entryUrl,
          title,
          artist,
          albumArt,
          Number(user.id),
          kind,
          entryChannel ? Number(entryChannel.id) : null,
          Number(entry.duration ?? 0) || null,
        ],
      );
      const id = Number(changes.lastInsertRowid);
      if (doDownload) {
        try {
          const filename = await ytdlp.downloadMusic(entryUrl, String(id));
          db.run("UPDATE music SET filename = ?, downloaded = 1 WHERE id = ?", [filename, id]);
        } catch (exc) {
          console.error(`  Download failed: ${title}: ${exc instanceof Error ? exc.message : String(exc)}`);
        }
      }
      const songs = getSongs(db, Number(playlist.id));
      songs.push({ music_id: id, position: songs.length });
      setSongs(db, Number(playlist.id), songs);
      console.log(`  Added: ${title}`);
    }
    console.log(`\n${doDownload ? "Downloaded" : "Added"} ${entries.length} tracks to '${playlist.name}'.`);
    return;
  }

  // Single item.
  const isYtmusic = url.includes("music.youtube.com");
  const contentType = type || (isYtmusic || info.artist || info.album || info.track ? "music" : "video");

  if (contentType === "video") {
    const videoId = info.id ? String(info.id) : null;
    const itemUrl = (info.webpage_url as string) || url;
    let existing = videoId ? db.query<Row, [string]>("SELECT * FROM videos WHERE video_id = ?").get(videoId) : null;
    if (existing) {
      console.log(`Video already exists: ${existing.title}`);
    } else {
      const changes = db.run(
        `INSERT INTO videos (video_id, title, url, thumbnail, duration, added_by, quality)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          videoId,
          info.title ? String(info.title) : null,
          itemUrl,
          ytdlp.pickVideoThumbnail(info),
          info.duration == null ? null : Number(info.duration),
          Number(user.id),
          quality,
        ],
      );
      const id = Number(changes.lastInsertRowid);
      if (doDownload) {
        try {
          const filename = await ytdlp.downloadVideo(itemUrl, String(id), quality);
          db.run("UPDATE videos SET filename = ?, downloaded = 1 WHERE id = ?", [filename, id]);
        } catch (exc) {
          console.error(`Download failed: ${info.title}: ${exc instanceof Error ? exc.message : String(exc)}`);
        }
      }
      console.log(`Added video: ${info.title}`);
      existing = db.query<Row, [number]>("SELECT * FROM videos WHERE id = ?").get(id);
    }
    if (playlistName) {
      let pl = db
        .query<Row, [string, number]>("SELECT * FROM playlists WHERE name = ? AND user_id = ? AND kind = 'video'")
        .get(playlistName, Number(user.id));
      if (!pl) {
        const changes = db.run("INSERT INTO playlists (name, user_id, kind, songs) VALUES (?, ?, 'video', '[]')", [
          playlistName,
          Number(user.id),
        ]);
        pl = db.query<Row, [number]>("SELECT * FROM playlists WHERE id = ?").get(Number(changes.lastInsertRowid))!;
      }
      const songs = getSongs(db, Number(pl.id));
      if (existing && !songs.some((x) => x.type === "video" && Number(x.video_id) === Number(existing.id))) {
        songs.push({ video_id: Number(existing.id), position: songs.length, type: "video" });
        setSongs(db, Number(pl.id), songs);
      }
      console.log(`Added to video playlist: ${pl.name}`);
    }
    return;
  }

  // Single music / podcast item.
  const kind = contentType === "podcast" ? "podcast" : "music";
  const title = cleanTitle(info.title ? String(info.title) : null);
  const artist = (info.artist as string) || (info.channel as string) || (info.uploader as string) || null;
  const videoId = info.id ? String(info.id) : null;
  const existing = videoId ? db.query<Row, [string]>("SELECT * FROM music WHERE video_id = ?").get(videoId) : null;
  if (existing) {
    console.log(`Music already exists: ${title}`);
    if (doDownload && !existing.downloaded) {
      try {
        const filename = await ytdlp.downloadMusic(String(existing.url || url), String(existing.id));
        db.run("UPDATE music SET filename = ?, downloaded = 1 WHERE id = ?", [filename, Number(existing.id)]);
        console.log(`Downloaded: ${title}`);
      } catch (exc) {
        console.error(`Download failed: ${title}: ${exc instanceof Error ? exc.message : String(exc)}`);
      }
    }
    return;
  }
  const channel = kind === "podcast" ? resolveMusicChannel(db, info) : null;
  const changes = db.run(
    `INSERT INTO music (video_id, url, title, artist, album_art, added_by, kind, channel_id, duration)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      videoId,
      (info.webpage_url as string) || url,
      title,
      artist,
      ytdlp.pickAlbumArt(info),
      Number(user.id),
      kind,
      channel ? Number(channel.id) : null,
      Number(info.duration ?? 0) || null,
    ],
  );
  const id = Number(changes.lastInsertRowid);
  let ok = false;
  if (doDownload) {
    try {
      const filename = await ytdlp.downloadMusic(url, String(id));
      db.run("UPDATE music SET filename = ?, downloaded = 1 WHERE id = ?", [filename, id]);
      ok = true;
    } catch (exc) {
      console.error(`Download failed: ${title}: ${exc instanceof Error ? exc.message : String(exc)}`);
    }
  }
  console.log(ok ? `Downloaded: ${title}` : `Added: ${title}`);

  if (playlistName) {
    const plConds = ["name = ?", "user_id = ?"];
    const plParams: (string | number)[] = [playlistName, Number(user.id)];
    if (kind === "podcast") plConds.push("kind = 'podcast'");
    let pl = db.query<Row, (string | number)[]>(`SELECT * FROM playlists WHERE ${plConds.join(" AND ")}`).get(...plParams);
    if (!pl) {
      const c2 = db.run("INSERT INTO playlists (name, user_id, kind, songs) VALUES (?, ?, ?, '[]')", [
        playlistName,
        Number(user.id),
        kind,
      ]);
      pl = db.query<Row, [number]>("SELECT * FROM playlists WHERE id = ?").get(Number(c2.lastInsertRowid))!;
    }
    const songs = getSongs(db, Number(pl.id));
    songs.push({ music_id: id, position: songs.length });
    setSongs(db, Number(pl.id), songs);
    console.log(`Added to playlist: ${pl.name}`);
  }
}

async function cmdExport(flags: Record<string, string | boolean>): Promise<void> {
  const db = openDb();
  const user = requireUser(db);

  const now = new Date();
  let dateFrom: string | null = null;
  const days = b(flags, "day") ? 1 : b(flags, "week") ? 7 : b(flags, "month") ? 30 : 0;
  if (days) dateFrom = new Date(now.getTime() - days * 86400_000).toISOString().replace("T", " ").replace("Z", "000");

  const all = (table: string, where: string, params: (string | number)[]): Row[] =>
    db.query<Row, (string | number)[]>(`SELECT * FROM ${table}${where ? ` WHERE ${where}` : ""}`).all(...params);

  const metadata: Record<string, unknown> = {
    version: 2,
    exported_at: now.toISOString().replace("Z", ""),
    users: all("users", "id = ?", [Number(user.id)]).map(serialize),
    channels: all("channels", "", []).map(serialize),
    subscriptions: all("subscriptions", "user_id = ?", [Number(user.id)]).map(serialize),
    videos: all("videos", dateFrom ? "added_by = ? AND created_at >= ?" : "added_by = ?", dateFrom ? [Number(user.id), dateFrom] : [Number(user.id)]).map(serialize),
    music: all("music", dateFrom ? "added_by = ? AND created_at >= ?" : "added_by = ?", dateFrom ? [Number(user.id), dateFrom] : [Number(user.id)]).map(serialize),
    playlists: all("playlists", "user_id = ?", [Number(user.id)]).map(serialize),
  };

  const plRef = s(flags, "playlist");
  if (plRef) {
    const playlist = resolvePlaylist(db, Number(user.id), plRef);
    if (!playlist) die(`Error: Playlist not found: ${plRef}`, 1);
    if (playlist.kind === "video") {
      const ids = new Set(getSongs(db, Number(playlist.id)).filter((x) => x.type === "video").map((x) => Number(x.video_id)));
      metadata.videos = (metadata.videos as Row[]).filter((v) => ids.has(Number(v.id)));
    } else {
      const ids = new Set(getSongs(db, Number(playlist.id)).map((x) => Number(x.music_id)));
      metadata.music = (metadata.music as Row[]).filter((m) => ids.has(Number(m.id)));
    }
    metadata.playlists = [serialize(playlist)];
  }

  metadata.settings = all("settings", "", []).map(serialize);

  const files: Record<string, Uint8Array> = {};
  for (const v of metadata.videos as Row[]) {
    if (!(v.downloaded && (v.filename || v.video_id))) continue;
    const fname = String(v.filename || `${v.video_id}.mp4`);
    const path = join(downloadsDir(), "videos", fname);
    if (statSync(path, { throwIfNoEntry: false })?.isFile()) files[`videos/${fname}`] = new Uint8Array(readFileSync(path));
  }
  for (const m of metadata.music as Row[]) {
    if (!m.filename) continue;
    const path = join(downloadsDir(), "music", String(m.filename));
    if (statSync(path, { throwIfNoEntry: false })?.isFile()) files[`music/${m.filename}`] = new Uint8Array(readFileSync(path));
  }
  const bytes = zipSync({ "metadata.json": strToU8(JSON.stringify(metadata, null, 2)), ...files });

  const output = s(flags, "output") || `hometube-export-${utcStamp()}.ht`;
  writeFileSync(output, bytes);

  const counts = (key: string) => (metadata[key] as Row[]).length;
  console.log(`Exported to ${output}`);
  console.log(
    `  Users: ${counts("users")}, Channels: ${counts("channels")}, Subscriptions: ${counts("subscriptions")}, ` +
      `Videos: ${counts("videos")}, Music: ${counts("music")}, Playlists: ${counts("playlists")}`,
  );
}

function extractMetadata(fpath: string): { title: string; artist: string; video_id: string | null; duration: number | null } {
  const stem = basename(fpath).replace(/\.[^.]+$/, "");
  let title = stem;
  let videoId: string | null = null;
  const m = /\[([^\]]+)\]$/.exec(stem);
  if (m) {
    videoId = m[1];
    title = stem.replace(/\s*\[([^\]]+)\]\s*$/, "");
  }
  let artist = "Unknown Artist";
  let duration: number | null = null;
  // mutagen in the Python CLI; ffprobe (a required dep anyway) reads the same
  // ID3/Vorbis/MP4 tag families here.
  try {
    const probe = runOut(["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", fpath]);
    const fmt = JSON.parse(probe)?.format ?? {};
    const tags = fmt.tags ?? {};
    if (tags.title) title = String(tags.title);
    if (tags.artist) artist = String(tags.artist);
    const d = Number(fmt.duration);
    if (Number.isFinite(d) && d > 0) duration = Math.round(d);
  } catch {
    /* fall back to filename-derived metadata */
  }
  return { title, artist, video_id: videoId, duration };
}

async function cmdImportMusic(folder: string, flags: Record<string, string | boolean>): Promise<void> {
  if (!folder || !statSync(folder, { throwIfNoEntry: false })?.isDirectory()) {
    die(`Error: folder not found: ${folder}`, 1);
  }
  const db = openDb();
  const user = requireUser(db);

  const playlistName = s(flags, "playlist");
  let playlist: Row | null = null;
  if (playlistName) {
    playlist = db.query<Row, [string, number]>("SELECT * FROM playlists WHERE name = ? AND user_id = ?").get(playlistName, Number(user.id));
    if (!playlist) {
      const changes = db.run("INSERT INTO playlists (name, user_id, kind, songs) VALUES (?, ?, 'music', '[]')", [
        playlistName,
        Number(user.id),
      ]);
      playlist = db.query<Row, [number]>("SELECT * FROM playlists WHERE id = ?").get(Number(changes.lastInsertRowid))!;
      console.log(`Created playlist: ${playlist.name}`);
    }
  }

  const SUPPORTED = new Set([".mp3", ".webm", ".flac", ".wav", ".m4a", ".ogg", ".aac"]);
  const musicDir = join(downloadsDir(), "music");
  mkdirSync(musicDir, { recursive: true });
  const existingFiles = new Set(readdirSync(musicDir));
  const move = b(flags, "move");
  let imported = 0;

  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(p));
      else if (entry.isFile()) out.push(p);
    }
    return out;
  };

  for (const fpath of walk(folder)) {
    const ext = fpath.slice(fpath.lastIndexOf(".")).toLowerCase();
    if (!SUPPORTED.has(ext)) continue;
    const meta = extractMetadata(fpath);

    let dest = `${meta.artist} - ${meta.title}${ext}`.replaceAll("/", "-").replaceAll("\\", "-");
    let counter = 0;
    const orig = dest;
    while (existingFiles.has(dest)) {
      counter++;
      dest = `${orig.slice(0, orig.lastIndexOf("."))} (${counter})${ext}`;
    }
    existingFiles.add(dest);

    const destPath = join(musicDir, dest);
    if (move) {
      try {
        renameSync(fpath, destPath);
      } catch (e) {
        // shutil.move falls back to copy+delete across devices (EXDEV).
        if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
        copyFileSync(fpath, destPath);
        rmSync(fpath);
      }
    } else copyFileSync(fpath, destPath);

    const changes = db.run(
      `INSERT INTO music (url, title, artist, video_id, filename, downloaded, added_by, duration)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      [`file://${dest}`, meta.title, meta.artist, meta.video_id, dest, Number(user.id), meta.duration],
    );
    if (playlist) {
      const songs = getSongs(db, Number(playlist.id));
      songs.push({ music_id: Number(changes.lastInsertRowid), position: songs.length });
      setSongs(db, Number(playlist.id), songs);
    }
    imported++;
    console.log(`  Imported: ${meta.title} by ${meta.artist}`);
  }

  console.log(`\nImported ${imported} song(s).`);
  if (playlist) console.log(`  Added to playlist: ${playlist.name}`);
}

async function cmdImport(file: string | undefined): Promise<void> {
  if (!file || !statSync(file, { throwIfNoEntry: false })?.isFile()) die(`Error: file not found: ${file}`, 1);
  if (!file.endsWith(".ht")) die("Error: file must have .ht extension", 1);

  const db = openDb();
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(readFileSync(file)));
  } catch (e) {
    die(`Import failed: ${e instanceof Error ? e.message : String(e)}`, 1);
  }
  if (!entries["metadata.json"]) die("Error: invalid .ht file -- missing metadata.json", 1);
  let metadata: Record<string, Row[]>;
  try {
    metadata = JSON.parse(new TextDecoder().decode(entries["metadata.json"]));
  } catch (e) {
    die(`Import failed: ${e instanceof Error ? e.message : String(e)}`, 1);
  }

  try {
    const { mediaExtracted } = importHt(db, metadata, entries, (msg) => console.log(msg));
    console.log("\nImport complete!");
    console.log(`  Users: ${(metadata.users ?? []).length}`);
    console.log(`  Channels: ${(metadata.channels ?? []).length}`);
    console.log(`  Subscriptions: ${(metadata.subscriptions ?? []).length}`);
    console.log(`  Videos: ${(metadata.videos ?? []).length}`);
    console.log(`  Music: ${(metadata.music ?? []).length}`);
    console.log(`  Playlists: ${(metadata.playlists ?? []).length}`);
    console.log(`  Media files extracted: ${mediaExtracted}`);
  } catch (e) {
    die(`Import failed: ${e instanceof Error ? e.message : String(e)}`, 1);
  }
}

function cmdSongs(db: Database): void {
  const user = requireUser(db);
  const songs = db
    .query<Row, [number]>("SELECT * FROM music WHERE added_by = ? ORDER BY created_at DESC")
    .all(Number(user.id));
  if (!songs.length) {
    console.log("No songs found.");
    return;
  }
  printTable(
    songs.map((m) => [
      m.id,
      String(m.title ?? "").slice(0, 50),
      m.artist ?? "",
      m.downloaded ? "y" : "n",
      dateStr(m.created_at),
    ]),
    ["ID", "Title", "Artist", "DL", "Date"],
  );
}

function cmdSongRemove(db: Database, idOrName: string): void {
  const user = requireUser(db);
  const music = resolveMusic(db, Number(user.id), idOrName);
  if (!music) die(`Error: Song not found: ${idOrName}`, 1);
  const playlists = db.query<Row, [number]>("SELECT * FROM playlists WHERE user_id = ?").all(Number(user.id));
  for (const pl of playlists) {
    const songs = getSongs(db, Number(pl.id));
    if (songs.length) setSongs(db, Number(pl.id), songs.filter((x) => Number(x.music_id) !== Number(music.id)));
  }
  if (music.filename) {
    const path = join(downloadsDir(), "music", String(music.filename));
    if (existsSync(path)) rmSync(path);
  }
  db.run("DELETE FROM music WHERE id = ?", [Number(music.id)]);
  console.log(`Removed song: ${music.title}`);
}

function cmdPlaylists(db: Database): void {
  const user = requireUser(db);
  const playlists = db
    .query<Row, [number]>("SELECT * FROM playlists WHERE user_id = ? ORDER BY created_at DESC")
    .all(Number(user.id));
  if (!playlists.length) {
    console.log("No playlists found.");
    return;
  }
  printTable(
    playlists.map((p) => [p.id, p.name, getSongs(db, Number(p.id)).length, dateStr(p.created_at)]),
    ["ID", "Name", "Songs", "Created"],
  );
}

function cmdPlaylistRemove(db: Database, idOrName: string): void {
  const user = requireUser(db);
  const playlist = resolvePlaylist(db, Number(user.id), idOrName);
  if (!playlist) die(`Error: Playlist not found: ${idOrName}`, 1);
  db.run("DELETE FROM playlists WHERE id = ?", [Number(playlist.id)]);
  console.log(`Removed playlist: ${playlist.name}`);
}

function cmdPlaylistAdd(db: Database, name: string): void {
  const user = requireUser(db);
  const existing = db
    .query<Row, [string, number]>("SELECT * FROM playlists WHERE name = ? AND user_id = ?")
    .get(name, Number(user.id));
  if (existing) {
    console.log(`Playlist already exists: ${name}`);
    return;
  }
  const changes = db.run("INSERT INTO playlists (name, user_id, kind, songs) VALUES (?, ?, 'music', '[]')", [
    name,
    Number(user.id),
  ]);
  console.log(`Created playlist: ${name} (id ${changes.lastInsertRowid})`);
}

function cmdPlaylistUpdateAdd(db: Database, idOrName: string, songRef: string): void {
  const user = requireUser(db);
  const playlist = resolvePlaylist(db, Number(user.id), idOrName);
  if (!playlist) die(`Error: Playlist not found: ${idOrName}`, 1);
  const music = resolveMusic(db, Number(user.id), songRef);
  if (!music) die(`Error: Song not found: ${songRef}`, 1);
  const songs = getSongs(db, Number(playlist.id));
  if (songs.some((x) => Number(x.music_id) === Number(music.id))) {
    console.log(`Song already in playlist: ${music.title}`);
    return;
  }
  songs.push({ music_id: Number(music.id), position: songs.length });
  setSongs(db, Number(playlist.id), songs);
  console.log(`Added '${music.title}' to playlist '${playlist.name}'`);
}

function cmdPlaylistUpdateRemove(db: Database, idOrName: string, songRef: string): void {
  const user = requireUser(db);
  const playlist = resolvePlaylist(db, Number(user.id), idOrName);
  if (!playlist) die(`Error: Playlist not found: ${idOrName}`, 1);
  const music = resolveMusic(db, Number(user.id), songRef);
  if (!music) die(`Error: Song not found: ${songRef}`, 1);
  const songs = getSongs(db, Number(playlist.id));
  const next = songs.filter((x) => Number(x.music_id) !== Number(music.id));
  if (next.length === songs.length) {
    console.log(`Song not in playlist: ${music.title}`);
    return;
  }
  setSongs(db, Number(playlist.id), next);
  console.log(`Removed '${music.title}' from playlist '${playlist.name}'`);
}

function cmdPlaylistUpdateRename(db: Database, idOrName: string, newName: string): void {
  const user = requireUser(db);
  const playlist = resolvePlaylist(db, Number(user.id), idOrName);
  if (!playlist) die(`Error: Playlist not found: ${idOrName}`, 1);
  const existing = db
    .query<Row, [string, number, number]>("SELECT * FROM playlists WHERE name = ? AND user_id = ? AND id != ?")
    .get(newName, Number(user.id), Number(playlist.id));
  if (existing) {
    console.log(`Another playlist already named '${newName}' exists.`);
    return;
  }
  db.run("UPDATE playlists SET name = ? WHERE id = ?", [newName, Number(playlist.id)]);
  console.log(`Renamed playlist '${playlist.name}' to '${newName}'`);
}

function cmdVideos(db: Database): void {
  const user = requireUser(db);
  const videos = db
    .query<Row, [number]>("SELECT * FROM videos WHERE added_by = ? ORDER BY created_at DESC")
    .all(Number(user.id));
  if (!videos.length) {
    console.log("No videos found.");
    return;
  }
  printTable(
    videos.map((v) => {
      let pos = "";
      if (v.position) {
        const [m, sec] = [Math.trunc(Number(v.position) / 60), Math.trunc(Number(v.position)) % 60];
        pos = `${m}:${String(sec).padStart(2, "0")}`;
      }
      return [
        v.id,
        String(v.title ?? "").slice(0, 55),
        v.watched_at ? "y" : "n",
        v.downloaded ? "y" : "n",
        v.keep_flag ? "y" : "",
        pos,
        dateStr(v.created_at),
      ];
    }),
    ["ID", "Title", "Watched", "DL", "Keep", "Resume", "Date"],
  );
}

function cmdVideoRemove(db: Database, idOrName: string): void {
  const user = requireUser(db);
  const video = resolveVideo(db, Number(user.id), idOrName);
  if (!video) die(`Error: Video not found: ${idOrName}`, 1);
  for (const pl of db.query<Row, [number]>("SELECT * FROM playlists WHERE user_id = ?").all(Number(user.id))) {
    const songs = getSongs(db, Number(pl.id));
    if (songs.length)
      setSongs(db, Number(pl.id), songs.filter((x) => !(x.type === "video" && Number(x.video_id) === Number(video.id))));
  }
  const candidates = [
    video.filename ? join(downloadsDir(), "videos", String(video.filename)) : null,
    video.video_id ? join(downloadsDir(), "videos", `${video.video_id}.mp4`) : null,
  ];
  for (const path of candidates) if (path && existsSync(path)) rmSync(path);
  db.run("DELETE FROM videos WHERE id = ?", [Number(video.id)]);
  console.log(`Removed video: ${video.title}`);
}

function cmdVideoWatched(db: Database, idOrName: string, unwatch: boolean): void {
  const user = requireUser(db);
  const video = resolveVideo(db, Number(user.id), idOrName);
  if (!video) die(`Error: Video not found: ${idOrName}`, 1);
  db.run("UPDATE videos SET watched_at = ? WHERE id = ?", [unwatch ? null : naiveNow(), Number(video.id)]);
  console.log(`${unwatch ? "Unmarked" : "Marked watched"}: ${video.title}`);
}

function cmdVideoKeep(db: Database, idOrName: string, unkeep: boolean): void {
  const user = requireUser(db);
  const video = resolveVideo(db, Number(user.id), idOrName);
  if (!video) die(`Error: Video not found: ${idOrName}`, 1);
  const keep = unkeep ? 0 : 1;
  db.run("UPDATE videos SET keep_flag = ? WHERE id = ?", [keep, Number(video.id)]);
  console.log(`${keep ? "Kept" : "Unkept"} video: ${video.title}`);
}

function cmdPodcasts(db: Database): void {
  const user = requireUser(db);
  const subs = db
    .query<Row, [number]>("SELECT * FROM subscriptions WHERE kind = 'podcast' AND user_id = ? ORDER BY created_at DESC")
    .all(Number(user.id));

  const rows: unknown[][] = [];
  for (const sub of subs) {
    const channel = db.query<Row, [number]>("SELECT * FROM channels WHERE id = ?").get(Number(sub.channel_id));
    if (!channel) continue;
    const count = db
      .query<{ n: number }, [number]>("SELECT COUNT(*) AS n FROM music WHERE kind = 'podcast' AND channel_id = ?")
      .get(Number(channel.id))!.n;
    rows.push([sub.id, String(channel.name || channel.url).slice(0, 50), count, dateStr(sub.created_at)]);
  }

  const subChannelIds = subs.map((x) => Number(x.channel_id));
  const conds = ["kind = 'podcast'", "added_by = ?"];
  const params: (string | number)[] = [Number(user.id)];
  if (subChannelIds.length) {
    conds.push(`(channel_id IS NULL OR channel_id NOT IN (${subChannelIds.map(() => "?").join(",")}))`);
    params.push(...subChannelIds);
  }
  const orphans = db
    .query<Row, (string | number)[]>(`SELECT * FROM music WHERE ${conds.join(" AND ")} ORDER BY created_at DESC`)
    .all(...params);

  if (!rows.length && !orphans.length) {
    console.log("No podcast feeds found.");
    return;
  }
  if (rows.length) {
    console.log("Feeds:");
    printTable(rows, ["SubID", "Feed", "Episodes", "Subscribed"]);
  }
  if (orphans.length) {
    if (rows.length) console.log();
    console.log("Standalone episodes (not in a feed):");
    printTable(
      orphans.map((m) => [m.id, String(m.title ?? "").slice(0, 50), m.artist ?? "", m.downloaded ? "y" : "n", dateStr(m.created_at)]),
      ["ID", "Title", "Artist", "DL", "Date"],
    );
  }
}

function cmdSettings(db: Database, sub: string | undefined, args: string[]): void {
  if (sub === "get") {
    const keys = args;
    if (keys.length) {
      for (const key of keys) {
        const row = db.query<{ value: string | null }, [string]>('SELECT value FROM settings WHERE "key" = ?').get(key);
        console.log(`${key} = ${row ? row.value : "(unset)"}`);
      }
    } else {
      for (const row of db.query<Row, []>('SELECT * FROM settings ORDER BY "key"').all()) {
        console.log(`${row.key} = ${row.value}`);
      }
    }
    return;
  }
  if (sub === "set") {
    const [key, value] = args;
    if (!key || value === undefined) die("usage: ht settings set <key> <value>", 2);
    const existing = db.query('SELECT "key" FROM settings WHERE "key" = ?').get(key);
    if (existing) db.run('UPDATE settings SET value = ? WHERE "key" = ?', [value, key]);
    else db.run('INSERT INTO settings ("key", value) VALUES (?, ?)', [key, value]);
    console.log(`${key} = ${value}`);
  }
}

function cmdPair(port: number, ttl: number): void {
  const db = openDb();
  const { token } = issuePairingToken(db, ttl);
  const ip = lanIp();
  console.log("Pairing token (single use)");
  console.log(`  URL:   http://${ip}:${port}`);
  console.log(`  Token: ${token}`);
  console.log();
  console.log("Enter in the mobile app's backend URL screen:");
  console.log(`  http://${ip}:${port}?token=${token}`);
}

function cmdServe(host: string, port: number): void {
  const ip = lanIp();
  if (host === "0.0.0.0" || host === "::" || host === "") {
    console.log(`Starting HomeTube server on http://${host}:${port}`);
    console.log(`  Local access via:  http://127.0.0.1:${port}`);
    console.log(`  LAN (phone/devices): http://${ip}:${port}`);
  } else {
    console.log(`Starting HomeTube server on http://${host}:${port}`);
  }
  const proc = Bun.spawn([process.execPath, "run", join(SERVER_DIR, "src", "index.ts")], {
    cwd: SERVER_DIR,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
    env: { ...process.env, PORT: String(port) },
  });
  proc.exited.then((code) => process.exit(code ?? 0));
}

function updateYtdlp(): void {
  if (!which("yt-dlp")) {
    console.log("yt-dlp not found; skipped its update.");
    return;
  }
  if (which("brew") && run(["brew", "list", "yt-dlp"], { quiet: true }) === 0) {
    console.log("Updating yt-dlp via Homebrew...");
    if (run(["brew", "upgrade", "yt-dlp"]) !== 0) console.error("Error: brew upgrade yt-dlp failed");
    return;
  }
  console.log("Updating yt-dlp...");
  if (run(["yt-dlp", "-U"]) !== 0) console.error("Error: yt-dlp self-update failed");
}

function cmdUpdate(): void {
  if (!existsSync(join(REPO_ROOT, ".git"))) die("Error: not a git repository — can't update", 1);
  console.log("Pulling latest from git...");
  if (run(["git", "pull"], { cwd: REPO_ROOT }) !== 0) die("Error: git pull failed", 1);
  console.log("Installing server dependencies...");
  if (run([process.execPath, "install"], { cwd: SERVER_DIR }) !== 0) die("Error: bun install failed", 1);
  updateYtdlp();
  console.log("Update complete.");
}

function apkPath(variant: string): string {
  return join(REPO_ROOT, "mobile", "android", "app", "build", "outputs", "apk", variant, `app-${variant}.apk`);
}

function buildApk(variant: string): void {
  const mobileDir = join(REPO_ROOT, "mobile");
  if (!statSync(mobileDir, { throwIfNoEntry: false })?.isDirectory()) die(`Error: mobile directory not found: ${mobileDir}`, 1);
  console.log("Syncing Android project via expo prebuild...");
  if (run(["npx", "expo", "prebuild", "--platform", "android"], { cwd: mobileDir }) !== 0) die("Error: expo prebuild failed", 1);
  const task = `assemble${variant[0].toUpperCase()}${variant.slice(1)}`;
  console.log(`Building Android app (${variant} variant)...`);
  const gradlew = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
  if (run([gradlew, task], { cwd: join(mobileDir, "android") }) !== 0) die("Error: build failed", 1);
  console.log(`Build complete: ${apkPath(variant)}`);
}

function appVersion(): string {
  try {
    return JSON.parse(readFileSync(join(REPO_ROOT, "mobile", "app.json"), "utf8"))?.expo?.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function gitShortSha(): string {
  return runOut(["git", "rev-parse", "--short", "HEAD"], REPO_ROOT).trim();
}

function releaseApk(variant: string, tag: string | null): void {
  const apk = apkPath(variant);
  if (!existsSync(apk)) {
    console.error(`APK not found: ${apk}`);
    die("Build it first with: ht mobile --build", 1);
  }
  if (!which("gh")) die("Error: GitHub CLI (gh) not found. Install it from https://cli.github.com/", 1);
  const relTag = tag || `mobile-v${appVersion()}`;
  if (run(["gh", "release", "view", relTag], { quiet: true }) === 0) {
    console.log(`Release ${relTag} already exists — uploading/replacing APK asset...`);
    if (run(["gh", "release", "upload", relTag, apk, "--clobber"]) !== 0) die("Error: GitHub release failed", 1);
  } else {
    const sha = gitShortSha();
    const notes = `Android ${variant} APK (${appVersion()}` + (sha ? `, commit ${sha})` : ")");
    console.log(`Creating GitHub release ${relTag}...`);
    if (
      run([
        "gh",
        "release",
        "create",
        relTag,
        apk,
        "--title",
        `HomeTube Mobile ${relTag}`,
        "--notes",
        notes,
      ]) !== 0
    )
      die("Error: GitHub release failed", 1);
  }
  console.log(`Released: ${relTag}`);
}

function findAdb(): string | null {
  const direct = which("adb");
  if (direct) return direct;
  const candidates = [
    process.env.ANDROID_HOME ? join(process.env.ANDROID_HOME, "platform-tools", "adb") : "",
    join(homedir(), "Library", "Android", "sdk", "platform-tools", "adb"),
    join(homedir(), "Android", "Sdk", "platform-tools", "adb"),
  ];
  return candidates.find((c) => c && existsSync(c)) ?? null;
}

function deployApk(variant: string, device: string | null): void {
  const apk = apkPath(variant);
  if (!existsSync(apk)) {
    console.error(`APK not found: ${apk}`);
    die("Build it first with: ht mobile --build", 1);
  }
  const adb = findAdb();
  if (!adb) die("Error: adb not found. Install Android Studio / platform-tools.", 1);
  const devices = runOut([adb, "devices"])
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.trim().split(/\s+/))
    .filter((p) => p.length === 2 && p[1] === "device")
    .map((p) => p[0]);
  if (!devices.length) die("No device connected. Enable USB debugging and connect your phone.", 1);
  if (device && !devices.includes(device)) {
    console.error(`Device not found: ${device}`);
    die(`Connected devices: ${devices.join(", ") || "(none)"}`, 1);
  }
  if (!device && devices.length > 1) {
    console.error(`Multiple devices connected: ${devices.join(", ")}`);
    die("Pick one with: ht mobile --deploy --device <serial>", 1);
  }
  const target = device || devices[0];
  console.log(`Installing ${apk} onto ${target}...`);
  if (run([adb, "-s", target, "install", "-r", apk]) !== 0) die("Error: install failed", 1);
  console.log("Installed successfully.");
}

function cmdBuildServer(clean: boolean): void {
  const outDir = join(SERVER_DIR, "dist");
  if (clean) rmSync(outDir, { recursive: true, force: true });
  const target = `bun-${process.platform}-${process.arch}`;
  console.log("Building hometube-server (bun compile)...");
  const code = run([
    process.execPath,
    "build",
    "--compile",
    `--target=${target}`,
    join(SERVER_DIR, "src", "index.ts"),
    "--outfile",
    join(outDir, "hometube-server"),
  ], { cwd: SERVER_DIR });
  const out = join(outDir, "hometube-server");
  if (code !== 0) die("Build failed.", code);
  console.log(`\nSidecar built: ${out}`);
  console.log("Try it:  PORT=8300 DATA_DIR=/tmp/ht-test " + out);
  console.log("Desktop: HOMETUBE_SERVER=" + out + " (npm run tauri dev)");
}

async function cmdFixart(dataDirArg: string | null): Promise<void> {
  const db: Database = dataDirArg ? openDb(join(resolve(dataDirArg), "db.sqlite")) : openDb();
  const missing = db
    .query<Row, []>("SELECT * FROM music WHERE album_art IS NULL OR album_art = ''")
    .all();
  if (!missing.length) {
    console.log("No music is missing album art.");
    return;
  }
  console.log(`Fetching album art for ${missing.length} tracks...`);

  // Same shape as Python's ThreadPoolExecutor(4): bounded concurrency with
  // results applied in row order.
  const results: (string | null)[] = new Array(missing.length).fill(null);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= missing.length) return;
      const m = missing[i];
      if (!m.url) continue;
      try {
        const info = await ytdlp.getVideoInfo(String(m.url));
        results[i] = info ? ytdlp.pickAlbumArt(info) : null;
      } catch {
        results[i] = null;
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);

  let fixed = 0;
  for (let i = 0; i < missing.length; i++) {
    const art = results[i];
    if (art) {
      db.run("UPDATE music SET album_art = ? WHERE id = ?", [art, Number(missing[i].id)]);
      fixed++;
    } else {
      console.log(`  Skipped (no art found): id=${missing[i].id}`);
    }
  }
  console.log(`Updated ${fixed} tracks.`);
}

// WKWebView (the desktop player) cannot decode Opus/Ogg/WebM audio. Legacy
// downloads preserved the source format; convert every such file on disk to
// MP3 (what current music downloads produce) and update the rows. Safe to
// re-run.
async function cmdFixaudio(dataDirArg: string | null): Promise<void> {
  const ffmpeg = which("ffmpeg");
  if (!ffmpeg) die("ffmpeg not found on PATH — install it first (e.g. brew install ffmpeg).");
  const db: Database = dataDirArg ? openDb(join(resolve(dataDirArg), "db.sqlite")) : openDb();
  const musicDir = join(downloadsDir(), "music");
  const rows = db
    .query<Row, []>(
      `SELECT * FROM music
       WHERE filename LIKE '%.opus' OR filename LIKE '%.ogg' OR filename LIKE '%.webm'
          OR url LIKE 'file://%.opus' OR url LIKE 'file://%.ogg' OR url LIKE 'file://%.webm'`,
    )
    .all();
  if (!rows.length) {
    console.log("Nothing to convert — every track is in a desktop-safe format.");
    return;
  }
  console.log(`Converting ${rows.length} tracks to MP3...`);
  const srcPathOf = (r: Row): string | null => {
    if (r.filename) {
      const p = join(musicDir, String(r.filename));
      if (existsSync(p)) return p;
    }
    const url = String(r.url ?? "");
    if (url.startsWith("file://")) {
      const p = decodeURIComponent(url.slice("file://".length));
      if (existsSync(p)) return p;
    }
    return null;
  };
  let done = 0;
  let skipped = 0;
  let idx = 0;
  const convert = async (r: Row): Promise<void> => {
    const src = srcPathOf(r);
    if (!src) {
      skipped++;
      console.log(`  Skipped (file not found): id=${r.id}`);
      return;
    }
    const out = src.replace(/\.[^.]+$/, ".mp3");
    const proc = Bun.spawn(
      [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", src, "-vn", "-c:a", "libmp3lame", "-q:a", "0", out],
      { stdout: "ignore", stderr: "pipe" },
    );
    const err = await new Response(proc.stderr).text();
    await proc.exited;
    if (proc.exitCode !== 0 || !existsSync(out) || statSync(out).size === 0) {
      skipped++;
      rmSync(out, { force: true });
      console.log(`  Skipped (ffmpeg failed): id=${r.id} ${err.trim().slice(0, 120)}`);
      return;
    }
    rmSync(src);
    if (r.filename) db.run("UPDATE music SET filename = ? WHERE id = ?", [basename(out), Number(r.id)]);
    if (String(r.url ?? "").startsWith("file://"))
      db.run("UPDATE music SET url = ? WHERE id = ?", [`file://${resolve(out)}`, Number(r.id)]);
    done++;
    console.log(`  ${done}/${rows.length} converted: ${basename(out)}`);
  };
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = idx++;
      if (i >= rows.length) return;
      await convert(rows[i]);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  console.log(`\nConverted ${done}, skipped ${skipped}.`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const USAGE = `HomeTube CLI -- manage your HomeTube instance from the terminal.

Usage:
  ht install                                Install the ht command to ~/.local/bin
  ht init                                   Interactive setup wizard
  ht login <user> [-y]                      Switch active user (creates if not exists)
  ht download <url> [--type video|music|podcast] [--playlist NAME]
                 [--quality Q] [--no-download]                       Download video/music/playlist
  ht export [-o FILE] [--day|--week|--month] [--playlist ID_OR_NAME]  Export .ht file
  ht import FILE.ht                          Import .ht archive
  ht import --music FOLDER [--playlist NAME] [--move]                 Import local music folder
  ht songs [remove ID_OR_NAME]               List or remove songs
  ht playlists [remove|add|update ...]       List or manage playlists
  ht videos [remove|watched|keep ...]        List or manage videos
  ht podcasts                                List podcast feeds and episodes
  ht settings get [KEY...] | set KEY VALUE   Read/write server settings
  ht update                                  Git pull + reinstall deps + yt-dlp update
  ht serve [--host H] [--port P]             Start the HomeTube server
  ht pair [--port P] [--ttl SECS]            Mint a one-time pairing token
  ht mobile --build|--release|--deploy       Android app workflows
  ht build-server [--clean]                  Compile the server sidecar with Bun
  ht fixart [--data-dir DIR]                 Backfill missing album art
  ht fixaudio [--data-dir DIR]               Convert Opus/Ogg/WebM music to MP3 (desktop playback)`;

function main(): void {
  const [, , command, ...rest] = process.argv;
  if (!command || command === "help" || command === "--help") {
    console.log(USAGE);
    return;
  }

  switch (command) {
    case "install":
      return void cmdInstall();
    case "init":
      return void cmdInit();
    case "login": {
      const { flags, positional } = parseFlags(rest, { yes: { alias: "-y" } });
      if (!positional[0]) die("usage: ht login <username>", 2);
      return void cmdLogin(positional[0], b(flags, "yes"));
    }
    case "download": {
      const { flags, positional } = parseFlags(rest, {
        type: { value: true },
        playlist: { alias: "-p", value: true },
        quality: { alias: "-q", value: true },
        download: {},
        "no-download": {},
      });
      if (!positional[0]) die("usage: ht download <url>", 2);
      return void cmdDownload(positional[0], flags);
    }
    case "export": {
      const { flags } = parseFlags(rest, {
        output: { alias: "-o", value: true },
        day: {},
        week: {},
        month: {},
        playlist: { alias: "-p", value: true },
      });
      return void cmdExport(flags);
    }
    case "import": {
      const { flags, positional } = parseFlags(rest, {
        music: { alias: "-m", value: true },
        playlist: { alias: "-p", value: true },
        move: {},
      });
      // Python: --music triggers folder import (positional file wins as the
      // folder); otherwise the positional is the .ht archive.
      if (s(flags, "music"))
        return void cmdImportMusic(positional[0] || (s(flags, "music") as string), flags);
      return void cmdImport(positional[0]);
    }
    case "songs": {
      const db = openDb();
      if (rest[0] === "remove") {
        if (!rest[1]) die("usage: ht songs remove <id_or_name>", 2);
        cmdSongRemove(db, rest[1]);
      } else {
        cmdSongs(db);
      }
      return;
    }
    case "playlists": {
      const db = openDb();
      const sub = rest[0];
      if (sub === "remove") {
        if (!rest[1]) die("usage: ht playlists remove <id_or_name>", 2);
        cmdPlaylistRemove(db, rest[1]);
      } else if (sub === "add") {
        if (!rest[1]) die("usage: ht playlists add <name>", 2);
        cmdPlaylistAdd(db, rest[1]);
      } else if (sub === "update") {
        const idOrName = rest[1];
        const action = rest[2];
        const arg = rest[3];
        if (!idOrName || !action || !arg) die("usage: ht playlists update <id_or_name> add|remove|rename <arg>", 2);
        if (action === "add") cmdPlaylistUpdateAdd(db, idOrName, arg);
        else if (action === "remove") cmdPlaylistUpdateRemove(db, idOrName, arg);
        else if (action === "rename") cmdPlaylistUpdateRename(db, idOrName, arg);
        else die(`unknown action: ${action}`, 2);
      } else {
        cmdPlaylists(db);
      }
      return;
    }
    case "videos": {
      const db = openDb();
      const sub = rest[0];
      if (sub === "remove") {
        if (!rest[1]) die("usage: ht videos remove <id_or_name>", 2);
        cmdVideoRemove(db, rest[1]);
      } else if (sub === "watched") {
        if (!rest[1]) die("usage: ht videos watched <id_or_name> [--unwatch]", 2);
        cmdVideoWatched(db, rest[1], rest.includes("--unwatch"));
      } else if (sub === "keep") {
        if (!rest[1]) die("usage: ht videos keep <id_or_name> [--unkeep]", 2);
        cmdVideoKeep(db, rest[1], rest.includes("--unkeep"));
      } else {
        cmdVideos(db);
      }
      return;
    }
    case "podcasts":
      return void (() => {
        cmdPodcasts(openDb());
      })();
    case "settings":
      return void cmdSettings(openDb(), rest[0], rest.slice(1));
    case "update":
      return void cmdUpdate();
    case "serve": {
      const { flags } = parseFlags(rest, { host: { value: true }, port: { value: true }, "log-level": { value: true } });
      return void cmdServe(s(flags, "host") ?? "0.0.0.0", Number(s(flags, "port") ?? 8000));
    }
    case "pair": {
      const { flags } = parseFlags(rest, { port: { value: true }, ttl: { value: true } });
      return void cmdPair(Number(s(flags, "port") ?? 8000), Number(s(flags, "ttl") ?? 600));
    }
    case "mobile": {
      const { flags } = parseFlags(rest, {
        build: {},
        release: {},
        deploy: {},
        debug: {},
        device: { value: true },
        tag: { value: true },
      });
      if (b(flags, "debug") && b(flags, "release")) die("Error: --debug cannot be combined with --release (debug APKs are not published).", 1);
      if (b(flags, "release") && b(flags, "deploy")) die("Error: pick one action at a time: --release publishes to GitHub, --deploy installs to a device.", 1);
      if (!(b(flags, "build") || b(flags, "release") || b(flags, "deploy"))) {
        console.log("Usage: ht mobile --build [--release] [--debug] | --deploy [--device <serial>]");
        return;
      }
      const variant = b(flags, "debug") ? "debug" : "release";
      if (b(flags, "build")) buildApk(variant);
      if (b(flags, "release")) releaseApk(variant, s(flags, "tag"));
      if (b(flags, "deploy")) deployApk(variant, s(flags, "device"));
      return;
    }
    case "build-server": {
      const { flags } = parseFlags(rest, { clean: {} });
      return void cmdBuildServer(b(flags, "clean"));
    }
    case "fixart": {
      const { flags } = parseFlags(rest, { "data-dir": { value: true } });
      return void cmdFixart(s(flags, "data-dir"));
    }
    case "fixaudio": {
      const { flags } = parseFlags(rest, { "data-dir": { value: true } });
      return void cmdFixaudio(s(flags, "data-dir"));
    }
    default:
      die(`ht: error: unknown command '${command}'\n\n${USAGE}`, 2);
  }
}

process.on("unhandledRejection", (reason) => {
  console.error(reason instanceof Error ? (reason.stack ?? reason.message) : String(reason));
  process.exit(1);
});

main();
