// Slice 4 routes: podcast feeds. Response shapes mirror main.py exactly;
// manual feed checks reuse the scheduler's backfill.
import type { Context, Hono } from "hono";
import type { Env } from "../app";
import { serialize, type Row } from "../db";
import { fail } from "../errors";
import * as ytdlp from "../services/ytdlp";
import { backfillPodcastEpisodes } from "../services/scheduler";

type App = Hono<Env>;

async function body(c: Context<Env>): Promise<Record<string, unknown>> {
  try {
    return (await c.req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function parseCriteria(v: unknown): Record<string, any> {
  if (typeof v !== "string") return (v as Record<string, any>) ?? {};
  try {
    const p = JSON.parse(v);
    return p && typeof p === "object" ? p : {};
  } catch {
    return {};
  }
}

function isoOrNull(v: unknown): string | null {
  return typeof v === "string" ? v.replace(" ", "T").replace(/\.000000$/, "") : null;
}

function getOrCreateChannel(c: Context<Env>, url: string, name?: string | null): Row {
  let chan = c.env.db.query<Row, [string]>("SELECT * FROM channels WHERE url = ?").get(url);
  if (!chan && name) chan = c.env.db.query<Row, [string]>("SELECT * FROM channels WHERE name = ?").get(name);
  if (!chan) {
    const changes = c.env.db.run("INSERT INTO channels (url, name) VALUES (?, ?)", [url, name || ""]);
    chan = c.env.db.query<Row, [number]>("SELECT * FROM channels WHERE id = ?").get(Number(changes.lastInsertRowid))!;
  }
  return chan;
}

function getPodcastSub(c: Context<Env>, id: number): Row {
  const sub = c.env.db
    .query<Row, [number]>("SELECT * FROM subscriptions WHERE id = ? AND kind = 'podcast'")
    .get(id);
  if (!sub) fail(404, "Not Found");
  return sub;
}

function getChannel(c: Context<Env>, id: number): Row {
  const chan = c.env.db.query<Row, [number]>("SELECT * FROM channels WHERE id = ?").get(Number(id));
  if (!chan) fail(404, "Not Found");
  return chan;
}

export function registerPodcasts(app: App) {
  app.get("/api/podcasts/episodes", (c) => {
    const userId = c.req.query("user_id");
    const subChannelIds = (
      userId
        ? c.env.db
            .query<{ channel_id: number }, [number]>(
              "SELECT channel_id FROM subscriptions WHERE kind = 'podcast' AND user_id = ?",
            )
            .all(Number(userId))
        : c.env.db
            .query<{ channel_id: number }, []>(
              "SELECT channel_id FROM subscriptions WHERE kind = 'podcast' AND user_id IS NULL",
            )
            .all()
    ).map((r) => Number(r.channel_id));

    const conds = ["kind = 'podcast'"];
    const params: (string | number)[] = [];
    if (userId) {
      conds.push("added_by = ?");
      params.push(Number(userId));
    }
    if (subChannelIds.length) {
      conds.push(`(channel_id IS NULL OR channel_id NOT IN (${subChannelIds.map(() => "?").join(",")}))`);
      params.push(...subChannelIds);
    }
    const rows = c.env.db
      .query<Row, (string | number)[]>(
        `SELECT * FROM music WHERE ${conds.join(" AND ")} ORDER BY created_at DESC`,
      )
      .all(...params);
    return c.json(rows.map(serialize));
  });

  app.get("/api/podcasts", (c) => {
    const userId = c.req.query("user_id");
    const conds = ["kind = 'podcast'"];
    const params: (string | number)[] = [];
    if (userId) {
      conds.push("user_id = ?");
      params.push(Number(userId));
    }
    const subs = c.env.db
      .query<Row, (string | number)[]>(
        `SELECT * FROM subscriptions WHERE ${conds.join(" AND ")} ORDER BY created_at DESC`,
      )
      .all(...params);
    const result = [];
    for (const sub of subs) {
      const channel = c.env.db
        .query<Row, [number]>("SELECT * FROM channels WHERE id = ?")
        .get(Number(sub.channel_id));
      if (!channel) continue; // Python skips subs whose channel is gone
      const counts = c.env.db
        .query<{ n: number; d: number }, [number]>(
          `SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN downloaded THEN 1 ELSE 0 END), 0) AS d
           FROM music WHERE kind = 'podcast' AND channel_id = ?`,
        )
        .get(Number(channel.id));
      result.push({
        subscription_id: sub.id,
        channel_id: channel.id,
        channel_name: channel.name ?? null,
        channel_url: channel.url ?? null,
        criteria: parseCriteria(sub.criteria),
        episode_count: counts?.n ?? 0,
        downloaded_count: counts?.d ?? 0,
        last_checked: isoOrNull(sub.last_checked),
        created_at: isoOrNull(sub.created_at),
      });
    }
    return c.json(result);
  });

  // Feed order matters vs /api/podcasts/:id/episodes only in method/path
  // shape; "subscribe" is a distinct literal segment from any :id/check.
  app.post("/api/podcasts/subscribe", async (c) => {
    const data = await body(c);
    const url = String(data.url ?? "");
    const info = await ytdlp.getVideoInfo(url);
    if (!info) fail(400, "Invalid channel URL");
    const channel = getOrCreateChannel(c, url, info.title || info.channel || null);
    const userId = data.user_id == null ? null : Number(data.user_id);
    const existing = c.env.db
      .query<Row, [number, number]>(
        "SELECT * FROM subscriptions WHERE channel_id = ? AND user_id = ? AND kind = 'podcast'",
      )
      .get(Number(channel.id), userId as number);
    if (existing) {
      return c.json({ ok: true, subscription_id: existing.id, channel_id: channel.id, backfilled: 0 });
    }
    const changes = c.env.db.run(
      "INSERT INTO subscriptions (channel_id, user_id, criteria, check_interval, kind) VALUES (?, ?, ?, ?, 'podcast')",
      [
        Number(channel.id),
        userId,
        JSON.stringify(data.criteria ?? {}),
        data.check_interval == null ? 3600 : Number(data.check_interval),
      ],
    );
    const subId = Number(changes.lastInsertRowid);
    const backfilled = await backfillPodcastEpisodes(channel, userId, parseCriteria(data.criteria ?? null));
    return c.json({ ok: true, subscription_id: subId, channel_id: channel.id, backfilled });
  });

  app.get("/api/podcasts/:id/episodes", (c) => {
    const sub = getPodcastSub(c, Number(c.req.param("id")));
    const channel = getChannel(c, Number(sub.channel_id));
    const episodes = c.env.db
      .query<Row, [number]>(
        "SELECT * FROM music WHERE kind = 'podcast' AND channel_id = ? ORDER BY created_at DESC",
      )
      .all(Number(channel.id));
    return c.json({
      subscription_id: sub.id,
      channel_id: channel.id,
      channel_name: channel.name ?? null,
      channel_url: channel.url ?? null,
      episodes: episodes.map(serialize),
    });
  });

  app.post("/api/podcasts/:id/check", async (c) => {
    const sub = getPodcastSub(c, Number(c.req.param("id")));
    const channel = getChannel(c, Number(sub.channel_id));
    const added = await backfillPodcastEpisodes(channel, sub.user_id as number | null, parseCriteria(sub.criteria));
    c.env.db.run("UPDATE subscriptions SET last_checked = ? WHERE id = ?", [
      new Date().toISOString().replace("T", " ").slice(0, 19),
      Number(sub.id),
    ]);
    return c.json({ ok: true, added });
  });

  app.delete("/api/podcasts/:id", (c) => {
    const sub = getPodcastSub(c, Number(c.req.param("id")));
    c.env.db.run("DELETE FROM subscriptions WHERE id = ?", [Number(sub.id)]);
    return c.json({ ok: true });
  });
}
