// Slice 6 routes: .ht export/import. Zip layout and metadata shape mirror
// main.py exactly: metadata.json (version 2, serialized rows per table) plus
// videos/ and music/ media files. FKs are remapped through old_id -> new_id
// tables on import; settings never overwrite existing keys and jwt_secret is
// skipped so importing another instance's backup cannot break auth.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { strToU8, unzipSync, zipSync } from "fflate";
import type { Context, Hono } from "hono";
import type { Env } from "../app";
import { serialize, type Row } from "../db";
import { fail, HttpError } from "../errors";
import { downloadsDir } from "../paths";
import { importHt, sqlDatetime } from "../hts";

type App = Hono<Env>;

// datetime.utcnow().isoformat() — microseconds, no Z.
function utcNowIso(): string {
  return new Date().toISOString().replace("Z", "");
}

function exportFilename(): string {
  const s = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `hometube-export-${s}.ht`;
}

interface ExportBody {
  type?: string;
  user_id?: number | null;
  date_from?: string | null;
  date_to?: string | null;
  video_ids?: number[] | null;
  music_ids?: number[] | null;
}

function mediaRows(
  c: Context<Env>,
  table: "videos" | "music",
  data: ExportBody,
  kind: "videos" | "music",
): Row[] {
  // type gate: videos rows only for "videos"/"all", music rows only for
  // "music"/"all" (Python's q.filter(False) branch yields nothing).
  const wanted = kind === "videos" ? data.type === "videos" || data.type === "all" : data.type === "music" || data.type === "all";
  if (!wanted) return [];
  const conds: string[] = [];
  const params: (string | number)[] = [];
  if (data.user_id) {
    conds.push("added_by = ?");
    params.push(Number(data.user_id));
  }
  const ids = kind === "videos" ? data.video_ids : data.music_ids;
  if (ids && ids.length) {
    conds.push(`id IN (${ids.map(() => "?").join(",")})`);
    params.push(...ids.map(Number));
  }
  if (data.date_from) {
    conds.push("created_at >= ?");
    params.push(sqlDatetime(String(data.date_from)));
  }
  if (data.date_to) {
    conds.push("created_at <= ?");
    params.push(sqlDatetime(String(data.date_to)));
  }
  const where = conds.length ? ` WHERE ${conds.join(" AND ")}` : "";
  return c.env.db.query<Row, (string | number)[]>(`SELECT * FROM ${table}${where}`).all(...params);
}

function userScoped(
  c: Context<Env>,
  table: string,
  column: string | null,
  userId: number | null | undefined,
): Row[] {
  if (column && userId) {
    return c.env.db
      .query<Row, [number]>(`SELECT * FROM ${table} WHERE ${column} = ?`)
      .all(Number(userId));
  }
  return c.env.db.query<Row, []>(`SELECT * FROM ${table}`).all();
}

export function registerExportImport(app: App) {
  app.post("/api/export", async (c) => {
    // FastAPI uses body defaults for a missing/invalid JSON body; mirror {}.
    const data = ((await c.req.json().catch(() => ({}))) as ExportBody) ?? {};
    const userId = data.user_id == null ? null : Number(data.user_id);
    const type = data.type ?? "all";

    const videos = mediaRows(c, "videos", { ...data, type }, "videos").map(serialize);
    const music = mediaRows(c, "music", { ...data, type }, "music").map(serialize);
    const metadata: Record<string, unknown> = {
      version: 2,
      exported_at: utcNowIso(),
      users: userScoped(c, "users", "id", userId).map(serialize),
      channels: userScoped(c, "channels", null, null).map(serialize),
      subscriptions: userScoped(c, "subscriptions", "user_id", userId).map(serialize),
      videos,
      music,
      playlists: userScoped(c, "playlists", "user_id", userId).map(serialize),
      settings: userScoped(c, "settings", null, null).map(serialize),
    };

    const entries: Record<string, Uint8Array> = {
      "metadata.json": strToU8(JSON.stringify(metadata, null, 2)),
    };
    const vDir = join(downloadsDir(), "videos");
    const mDir = join(downloadsDir(), "music");
    for (const v of videos) {
      if (!(v.downloaded && (v.filename || v.video_id))) continue;
      const fname = String(v.filename || `${v.video_id}.mp4`);
      const path = join(vDir, fname);
      if (existsSync(path)) entries[`videos/${fname}`] = new Uint8Array(readFileSync(path));
    }
    for (const m of music) {
      if (!m.filename) continue;
      const path = join(mDir, String(m.filename));
      if (existsSync(path)) entries[`music/${m.filename}`] = new Uint8Array(readFileSync(path));
    }

    const bytes = zipSync(entries);
    return new Response(bytes, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${exportFilename()}"`,
      },
    });
  });

  app.post("/api/import", async (c) => {
    const form = await c.req.parseBody();
    const file = form.file;
    if (!(file instanceof File) || !String(file.name ?? "").endsWith(".ht")) {
      fail(400, "File must have .ht extension");
    }
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
    } catch (e) {
      fail(400, `Import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!entries["metadata.json"]) fail(400, "Invalid .ht file: missing metadata.json");
    let metadata: Record<string, Row[]>;
    try {
      metadata = JSON.parse(new TextDecoder().decode(entries["metadata.json"]));
    } catch (e) {
      fail(400, `Import failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    const { summary } = (() => {
      try {
        return importHt(c.env.db, metadata, entries);
      } catch (e) {
        if (e instanceof HttpError) fail(e.status, e.message);
        fail(400, `Import failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();

    return c.json({ ok: true, summary });
  });
}
