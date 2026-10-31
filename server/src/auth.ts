// Auth — ports backend/services/pairing.py + main.py's JWT layer.
// Tokens live in the settings table, so pairing works across both servers
// (and the Python CLI) against the same SQLite file. The JWT secret is read
// from the same settings row, which keeps JWTs already issued to mobile
// clients valid across the Python -> JS cutover.
import { randomBytes } from "crypto";
import { networkInterfaces } from "node:os";
import type { Database } from "bun:sqlite";
import { getSetting, setSetting } from "./db";

const PAIRING_KEY = "pairing_tokens";
const DEFAULT_TTL = 300;

type PairEntry = { token: string; expires: number };

function activeTokens(db: Database): PairEntry[] {
  const raw = getSetting(db, PAIRING_KEY);
  let tokens: unknown;
  try {
    tokens = raw ? JSON.parse(raw) : [];
  } catch {
    tokens = [];
  }
  const now = Date.now() / 1000;
  return (Array.isArray(tokens) ? tokens : []).filter(
    (t): t is PairEntry => !!t && typeof t === "object" && (t as PairEntry).expires > now,
  );
}

export function issuePairingToken(db: Database, ttl = DEFAULT_TTL): { token: string; ttl: number } {
  const token = randomBytes(16).toString("base64url");
  const tokens = activeTokens(db);
  tokens.push({ token, expires: Date.now() / 1000 + ttl });
  setSetting(db, PAIRING_KEY, JSON.stringify(tokens));
  return { token, ttl: Math.trunc(ttl) };
}

export function consumePairingToken(db: Database, token: string): boolean {
  if (!token) return false;
  const tokens = activeTokens(db);
  const remaining = tokens.filter((t) => t.token !== token);
  if (remaining.length === tokens.length) return false;
  setSetting(db, PAIRING_KEY, JSON.stringify(remaining));
  return true;
}

export function lanIp(): string {
  // Bun's dgram connect is lazy (address() still reports 127.0.0.1), so walk
  // interfaces instead: first non-internal IPv4 wins, matching the UDP-trick
  // result on typical single-Wi-Fi hosts.
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === "IPv4" && !a.internal) return a.address;
    }
  }
  return "127.0.0.1";
}

export function isLocal(remoteIp: string): boolean {
  return ["127.0.0.1", "::1", "localhost", "::ffff:127.0.0.1"].includes(remoteIp);
}

// ---- JWT (HS256, secret persisted in the settings table) ----
// Hand-rolled on WebCrypto: identical wire format to python-jwt, and it
// sidesteps jose's browser-bundle resolution under `bun run`/`--compile`.

let jwtSecret: string | null = null;

export function getJwtSecret(db: Database): string {
  if (jwtSecret) return jwtSecret;
  const existing = getSetting(db, "jwt_secret");
  if (existing) {
    jwtSecret = existing;
  } else {
    jwtSecret = randomBytes(64).toString("base64url");
    setSetting(db, "jwt_secret", jwtSecret);
  }
  return jwtSecret;
}

async function hmacSha256(secret: string, msg: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg)));
}

const b64u = (input: string | Uint8Array): string =>
  Buffer.from(typeof input === "string" ? new TextEncoder().encode(input) : input).toString(
    "base64url",
  );

export async function createJwt(db: Database, userId: number): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64u(JSON.stringify({ user_id: userId, exp: now + 365 * 86400, iat: now }));
  const sig = b64u(await hmacSha256(getJwtSecret(db), `${head}.${payload}`));
  return `${head}.${payload}.${sig}`;
}

/** Returns the payload, or throws { status, detail } mirroring the API errors. */
export async function verifyJwt(db: Database, token: string): Promise<{ user_id: number }> {
  const invalid = { status: 401, detail: "Invalid token" };
  const parts = token.split(".");
  if (parts.length !== 3) throw invalid;
  const [head, payload, sig] = parts as [string, string, string];
  const expected = b64u(await hmacSha256(getJwtSecret(db), `${head}.${payload}`));
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(sig);
  let diff = a.length ^ b.length; // constant-time compare
  for (let i = 0; i < Math.min(a.length, b.length); i++) diff |= a[i]! ^ b[i]!;
  if (diff !== 0) throw invalid;
  let claims: { user_id?: number; exp?: number };
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw invalid;
  }
  if (typeof claims.exp === "number" && claims.exp < Math.floor(Date.now() / 1000)) {
    throw { status: 401, detail: "Token expired" };
  }
  return { user_id: claims.user_id as number };
}
