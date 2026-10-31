// SQLite layer — bun:sqlite on the same db.sqlite file the Python backend
// uses. The DDL below is byte-identical to what SQLAlchemy's create_all
// produced (with IF NOT EXISTS), so this server adopts existing libraries
// untouched and initializes fresh ones.
import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { dirname, join } from "path";
import { dbPath, downloadsDir } from "./paths";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
	id INTEGER NOT NULL,
	username VARCHAR(50) NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (username)
);
CREATE TABLE IF NOT EXISTS channels (
	id INTEGER NOT NULL,
	url VARCHAR(500) NOT NULL,
	name VARCHAR(200),
	PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS settings (
	"key" VARCHAR(100) NOT NULL,
	value TEXT,
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY ("key")
);
CREATE TABLE IF NOT EXISTS subscriptions (
	id INTEGER NOT NULL,
	channel_id INTEGER NOT NULL,
	user_id INTEGER NOT NULL,
	criteria JSON,
	check_interval INTEGER,
	last_checked DATETIME,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP, kind VARCHAR(20) DEFAULT 'video',
	PRIMARY KEY (id),
	FOREIGN KEY(channel_id) REFERENCES channels (id),
	FOREIGN KEY(user_id) REFERENCES users (id)
);
CREATE TABLE IF NOT EXISTS playlists (
	id INTEGER NOT NULL,
	name VARCHAR(200) NOT NULL,
	user_id INTEGER,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	songs JSON, kind VARCHAR(20) DEFAULT 'music',
	PRIMARY KEY (id),
	FOREIGN KEY(user_id) REFERENCES users (id)
);
CREATE TABLE IF NOT EXISTS videos (
	id INTEGER NOT NULL,
	video_id VARCHAR(20),
	title VARCHAR(300),
	channel_id INTEGER,
	url VARCHAR(500),
	downloaded BOOLEAN,
	added_by INTEGER,
	watched_at DATETIME,
	keep_flag BOOLEAN,
	quality VARCHAR(20),
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP, thumbnail VARCHAR(500), filename VARCHAR(500), position FLOAT, duration INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY(channel_id) REFERENCES channels (id),
	FOREIGN KEY(added_by) REFERENCES users (id)
);
CREATE TABLE IF NOT EXISTS music (
	id INTEGER NOT NULL,
	video_id VARCHAR(20),
	url VARCHAR(500),
	title VARCHAR(300),
	artist VARCHAR(200),
	album_art VARCHAR(500),
	filename VARCHAR(500),
	is_playlist BOOLEAN,
	playlist_id VARCHAR(50),
	downloaded BOOLEAN,
	added_by INTEGER,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP, kind VARCHAR(20) DEFAULT 'music', channel_id INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY(added_by) REFERENCES users (id)
);
CREATE TABLE IF NOT EXISTS downloads (
	id INTEGER NOT NULL,
	type VARCHAR(10),
	item_id INTEGER,
	user_id INTEGER,
	status VARCHAR(20),
	progress INTEGER,
	file_path VARCHAR(500),
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (id),
	FOREIGN KEY(user_id) REFERENCES users (id)
);
CREATE TABLE IF NOT EXISTS playlist_music (
	playlist_id INTEGER NOT NULL,
	music_id INTEGER NOT NULL,
	position INTEGER,
	PRIMARY KEY (playlist_id, music_id),
	FOREIGN KEY(playlist_id) REFERENCES playlists (id),
	FOREIGN KEY(music_id) REFERENCES music (id)
);
CREATE TABLE IF NOT EXISTS devices (
	id INTEGER NOT NULL,
	token_hash VARCHAR(64) NOT NULL,
	user_id INTEGER,
	name VARCHAR(200),
	platform VARCHAR(50),
	first_seen INTEGER,
	last_seen INTEGER,
	PRIMARY KEY (id),
	UNIQUE (token_hash)
);
`;

// Columns the ORM exposes as JSON booleans; SQLite stores 0/1.
const BOOL_COLUMNS = new Set(["downloaded", "keep_flag", "is_playlist"]);
// DATETIME columns; SQLite keeps "YYYY-MM-DD HH:MM:SS" and FastAPI emitted
// ISO ("YYYY-MM-DDTHH:MM:SS") on the wire.
const DATE_COLUMNS = new Set(["created_at", "watched_at", "last_checked", "updated_at"]);
// JSON TEXT columns decoded before sending.
const JSON_COLUMNS = new Set(["criteria", "songs"]);

export type Row = Record<string, unknown>;

/** Normalize one row to the exact JSON shape FastAPI/sqlalchemy produced. */
export function serialize(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined) out[k] = null;
    else if (BOOL_COLUMNS.has(k)) out[k] = Boolean(v);
    else if (DATE_COLUMNS.has(k) && typeof v === "string") {
      // Python isoformat() drops zero microseconds; the raw column keeps them.
      out[k] = v.replace(" ", "T").replace(/\.000000$/, "");
    }
    else if (JSON_COLUMNS.has(k) && typeof v === "string") {
      try {
        out[k] = JSON.parse(v);
      } catch {
        out[k] = v;
      }
    } else out[k] = v;
  }
  return out;
}

export function openDb(pathOverride?: string): Database {
  const path = pathOverride ?? dbPath();
  mkdirSync(dirname(path), { recursive: true });
  mkdirSync(join(downloadsDir(), "videos"), { recursive: true });
  mkdirSync(join(downloadsDir(), "music"), { recursive: true });
  const db = new Database(path);
  db.run("PRAGMA journal_mode=WAL");
  db.run(SCHEMA);
  return db;
}

export function getSetting(db: Database, key: string): string | null {
  const row = db.query<{ value: string | null }, [string]>(
    'SELECT value FROM settings WHERE "key" = ?',
  ).get(key);
  return row?.value ?? null;
}

export function setSetting(db: Database, key: string, value: string): void {
  db.run(
    `INSERT INTO settings ("key", value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT("key") DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    [key, value],
  );
}
