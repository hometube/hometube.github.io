// Slice 1 routes: status, pairing/auth, users, settings, subscriptions,
// downloads (stub until the job registry is ported). Response shapes match
// the FastAPI server exactly, verified by a side-by-side parity harness.
import type { Hono, Context } from "hono";
import type { Env } from "../app";
import { consumePairingToken, issuePairingToken, createJwt, isLocal, lanIp } from "../auth";
import { serialize, setSetting, type Row } from "../db";
import { toolStatus } from "../tools";
import * as downloader from "../services/downloader";

type App = Hono<Env>;

async function body(c: Context<Env>): Promise<Record<string, unknown>> {
  try {
    return (await c.req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function registerCore(app: App) {
  app.get("/api/status", (c) =>
    c.json({
      status: "ok",
      version: "1.0",
      pairing_required: true,
      tools: toolStatus(),
    }),
  );

  // Mint a single-use token; host-machine only (same rule as main.py).
  app.post("/api/desktop/pair", (c) => {
    if (!isLocal(c.env.remoteIp)) {
      return c.json({ detail: "Pairing tokens can only be minted on the host machine" }, 403);
    }
    const { token, ttl } = issuePairingToken(c.env.db);
    const port = Number(process.env.PORT ?? 8000);
    return c.json({ token, expires_in: ttl, url: `http://${lanIp()}:${port}` });
  });

  app.post("/api/auth/exchange", async (c) => {
    const data = await body(c);
    if (!consumePairingToken(c.env.db, String(data.token ?? ""))) {
      return c.json({ detail: "Invalid or expired pairing token" }, 403);
    }
    // Get or create the "system" user backing device JWTs.
    let user = c.env.db
      .query<Row, [string]>("SELECT * FROM users WHERE username = ?")
      .get("system");
    if (!user) {
      const changes = c.env.db.run("INSERT INTO users (username) VALUES (?)", ["system"]);
      user = { id: Number(changes.lastInsertRowid), username: "system" };
    }
    const jwt = await createJwt(c.env.db, Number(user.id));
    return c.json({ token: jwt, token_type: "bearer" });
  });

  app.get("/api/users", (c) => {
    const rows = c.env.db
      .query<Row, []>("SELECT id, username FROM users ORDER BY id")
      .all();
    return c.json(rows.map(serialize));
  });

  // Idempotent create (matches main.py: existing username returns that user).
  app.post("/api/users", async (c) => {
    const data = await body(c);
    const username = String(data.username ?? "");
    let user = c.env.db
      .query<Row, [string]>("SELECT id, username FROM users WHERE username = ?")
      .get(username);
    if (!user && username) {
      const changes = c.env.db.run("INSERT INTO users (username) VALUES (?)", [username]);
      user = { id: Number(changes.lastInsertRowid), username };
    }
    if (!user) throw { status: 400, detail: "username required" };
    return c.json(serialize(user));
  });

  app.get("/api/settings", (c) => {
    const rows = c.env.db.query<{ key: string; value: string | null }, []>(
      'SELECT "key", value FROM settings',
    ).all();
    const out: Record<string, string | null> = {};
    for (const r of rows) out[r.key] = r.value;
    return c.json(out);
  });

  app.put("/api/settings", async (c) => {
    const data = await body(c);
    const key = String(data.key ?? "");
    const value = String(data.value ?? "");
    setSetting(c.env.db, key, value);
    return c.json({ ok: true, key, value });
  });

  app.get("/api/subscriptions", (c) => {
    const userId = c.req.query("user_id");
    const kind = c.req.query("kind");
    const conds: string[] = [];
    const params: (string | number)[] = [];
    if (userId) {
      conds.push("s.user_id = ?");
      params.push(Number(userId));
    }
    if (kind) {
      conds.push("s.kind = ?");
      params.push(kind);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const subs = c.env.db
      .query<Row, (string | number)[]>(
        `SELECT s.*, ch.name AS channel_name, ch.url AS channel_url
         FROM subscriptions s LEFT JOIN channels ch ON ch.id = s.channel_id
         ${where} ORDER BY s.kind, s.created_at DESC`,
      )
      .all(...params);

    const result = [];
    for (const s of subs) {
      if (!s.channel_name) continue; // channel gone -> same as Python skip
      const counts =
        s.kind === "podcast"
          ? c.env.db
              .query<{ n: number; d: number }, [number]>(
                `SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN downloaded THEN 1 ELSE 0 END), 0) AS d
                 FROM music WHERE kind = 'podcast' AND channel_id = ?`,
              )
              .get(Number(s.channel_id))
          : c.env.db
              .query<{ n: number; d: number }, [number]>(
                `SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN filename IS NOT NULL THEN 1 ELSE 0 END), 0) AS d
                 FROM videos WHERE channel_id = ?`,
              )
              .get(Number(s.channel_id));
      result.push({
        subscription_id: s.id,
        channel_id: s.channel_id,
        channel_name: s.channel_name,
        channel_url: s.channel_url ?? "",
        kind: s.kind ?? "video",
        user_id: s.user_id,
        criteria: parseJson(s.criteria, {}),
        item_count: counts?.n ?? 0,
        downloaded_count: counts?.d ?? 0,
        last_checked: isoOrNull(s.last_checked),
        created_at: isoOrNull(s.created_at),
      });
    }
    return c.json(result);
  });

  app.delete("/api/subscriptions/:id", (c) => {
    const id = Number(c.req.param("id"));
    const changes = c.env.db.run("DELETE FROM subscriptions WHERE id = ?", [id]);
    if (!changes.changes) return c.json({ detail: "Not Found" }, 404);
    return c.json({ ok: true });
  });

  app.get("/api/downloads", (c) => {
    const userId = c.req.query("user_id");
    return c.json(downloader.listJobs(userId == null ? null : Number(userId)));
  });

  // Paired-device roster, refreshed by the auth middleware heartbeat.
  // No DELETE: JWTs are not revocable, so "forgetting" a device would be
  // misleading — stale rows simply drop offline.
  app.get("/api/devices", (c) => {
    const now = Math.floor(Date.now() / 1000);
    const rows = c.env.db
      .query<Row, []>(
        `SELECT d.id, d.name, d.platform, d.user_id, u.username, d.first_seen, d.last_seen
         FROM devices d LEFT JOIN users u ON u.id = d.user_id
         ORDER BY d.last_seen DESC`,
      )
      .all();
    return c.json(
      rows.map((r) => ({
        id: r.id,
        name: r.name ?? "Device",
        platform: r.platform ?? "unknown",
        user_id: r.user_id ?? null,
        username: r.username ?? null,
        online: Number(r.last_seen) > now - 60,
        last_seen: new Date(Number(r.last_seen) * 1000).toISOString(),
      })),
    );
  });
}

function parseJson(v: unknown, fallback: unknown): unknown {
  if (typeof v !== "string") return v ?? fallback;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

function isoOrNull(v: unknown): string | null {
  return typeof v === "string" ? v.replace(" ", "T").replace(/\.000000$/, "") : null;
}
