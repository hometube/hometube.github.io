// Hono app assembly: CORS, auth middleware (host-local exempt, JWT for LAN),
// and FastAPI-shaped error/not-found JSON bodies.
import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import type { Database } from "bun:sqlite";
import { isLocal, touchDevice, verifyJwt } from "./auth";
import { HttpError } from "./errors";

export type Env = { Bindings: { remoteIp: string; db: Database } };

/** Throws {status, detail} on failure, like the Python verify_token dependency. */
export async function requireToken(c: Context<Env>) {
  if (isLocal(c.env.remoteIp)) return;
  const url = new URL(c.req.url);
  const bearer = c.req.header("authorization");
  const token = url.searchParams.get("token") ?? (bearer?.startsWith("Bearer ") ? bearer.slice(7) : null);
  if (!token) throw { status: 401, detail: "Missing token" };
  const { user_id } = await verifyJwt(c.env.db, token);
  // Device presence heartbeat: one long-lived JWT per paired device, so any
  // authenticated request refreshes its last_seen (upsert throttled in SQL).
  touchDevice(c.env.db, token, c.req.header("user-agent") ?? "", user_id);
}

// Endpoints reachable without a JWT (a brand-new device has none yet).
const PUBLIC = new Set(["/api/status", "/api/auth/exchange"]);

export function createApp() {
  const app = new Hono<Env>();

  app.use("*", cors({ origin: "*", allowHeaders: ["Content-Type", "Authorization"] }));

  app.use("/api/*", async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (!PUBLIC.has(path)) {
      try {
        await requireToken(c);
      } catch (e) {
        const err = e as { status?: number; detail?: string };
        return c.json({ detail: err.detail ?? "Unauthorized" }, (err.status ?? 401) as 401);
      }
    }
    return next();
  });

  app.onError((e, c) => {
    if (e instanceof HttpError) {
      return c.json({ detail: e.message }, e.status as 400);
    }
    const err = e as { status?: number; detail?: string };
    if (typeof err.status === "number") {
      return c.json({ detail: err.detail ?? "Error" }, err.status as 400);
    }
    console.error("[server]", e);
    return c.json({ detail: "Internal Server Error" }, 500);
  });

  app.notFound((c) => c.json({ detail: "Not Found" }, 404));

  return app;
}
