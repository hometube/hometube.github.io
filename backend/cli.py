#!/usr/bin/env python3
"""
HomeTube CLI – manage your HomeTube instance from the terminal.

Usage:
  ht install              Install the ht command to ~/.local/bin
  ht init                 Interactive setup wizard
  ht login <user>         Switch active user (creates if not exists)
  ht download <url>       Download video/music/playlist
  ht export               Export .ht file for active user
  ht export --playlist <id_or_name>  Export a specific playlist
  ht import <file.ht>        Import .ht archive
  ht import --music <folder>  Import music files from local folder
ht songs                List music for active user
  ht playlists            List playlists for active user
  ht videos               List videos for active user
  ht serve                Start the HomeTube server
  ht build                Build the Android app (release by default)
  ht deploy               Install the built app onto a connected device
  ht fixart               Backfill missing album art for downloaded music
"""

import argparse
import json
import os
import subprocess
import sys
import zipfile
import io
import re
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
CONFIG_DIR = Path.home() / ".config" / "hometube"
CONFIG_FILE = CONFIG_DIR / "config.json"

DL_DIR = None
DB_PATH = None


def load_config():
    if CONFIG_FILE.exists():
        return json.loads(CONFIG_FILE.read_text())
    return {}


def save_config(config):
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(config, indent=2))


def setup_paths():
    global DL_DIR, DB_PATH
    config = load_config()
    data_dir = config.get("data_dir", "data")
    DL_DIR = os.path.join(data_dir, "downloads")
    DB_PATH = os.path.join(data_dir, "db.sqlite")
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    os.makedirs(f"{DL_DIR}/videos", exist_ok=True)
    os.makedirs(f"{DL_DIR}/music", exist_ok=True)


def get_db():
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from database import Base
    import models  # registers tables with Base.metadata

    setup_paths()
    engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)
    return SessionLocal()


def get_active_user(db):
    config = load_config()
    username = config.get("active_user")
    if username:
        from models import User
        user = db.query(User).filter(User.username == username).first()
        if user:
            return user
    return None


def serialize_row(obj):
    d = {}
    for col in obj.__table__.columns:
        val = getattr(obj, col.name)
        if isinstance(val, datetime):
            val = val.isoformat()
        d[col.name] = val
    return d


def print_table(rows, headers):
    if not rows:
        print("No results.")
        return
    col_widths = [len(h) for h in headers]
    for row in rows:
        for i, cell in enumerate(row):
            col_widths[i] = max(col_widths[i], len(str(cell)))
    header_line = "  ".join(h.ljust(w) for h, w in zip(headers, col_widths))
    print(header_line)
    print("-" * len(header_line))
    for row in rows:
        print("  ".join(str(c).ljust(w) for c, w in zip(row, col_widths)))


def _resolve_playlist(db, user_id, id_or_name):
    from models import Playlist
    try:
        pk = int(id_or_name)
        return db.query(Playlist).filter(Playlist.id == pk, Playlist.user_id == user_id).first()
    except ValueError:
        return db.query(Playlist).filter(Playlist.name == id_or_name, Playlist.user_id == user_id).first()


def _resolve_music(db, user_id, id_or_name):
    from models import Music
    try:
        pk = int(id_or_name)
        return db.query(Music).filter(Music.id == pk, Music.added_by == user_id).first()
    except ValueError:
        return db.query(Music).filter(Music.title.ilike(id_or_name), Music.added_by == user_id).first()


def _resolve_video(db, user_id, id_or_name):
    from models import Video
    try:
        pk = int(id_or_name)
        return db.query(Video).filter(Video.id == pk, Video.added_by == user_id).first()
    except ValueError:
        return db.query(Video).filter(Video.title.ilike(id_or_name), Video.added_by == user_id).first()


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

def check_js_runtime():
    """Warn if no supported JavaScript runtime is installed for YouTube downloads."""
    if any(shutil.which(r) for r in ("deno", "node", "quickjs", "bun")):
        return True
    print("Warning: No JavaScript runtime found. Newer yt-dlp requires one (e.g. Deno)", file=sys.stderr)
    print("  for YouTube downloads. Install one on macOS with:", file=sys.stderr)
    print("    brew install deno", file=sys.stderr)
    print("  See https://github.com/yt-dlp/yt-dlp/wiki/EJS for alternatives.", file=sys.stderr)
    return False


def check_ytdlp():
    """Check if yt-dlp is installed and warn if not."""
    if not shutil.which("yt-dlp"):
        print("Warning: yt-dlp not found. Install it with:")
        print("  brew install yt-dlp          # macOS")
        print("  sudo apt install yt-dlp      # Linux")
        print("  pip install yt-dlp           # pip")
        print()
        return False
    check_js_runtime()
    return True


def cmd_install(args):
    """Create the ht wrapper script in ~/.local/bin."""
    cli_path = os.path.abspath(__file__)
    bin_dir = Path.home() / ".local" / "bin"
    bin_dir.mkdir(parents=True, exist_ok=True)
    ht_path = bin_dir / "ht"

    # Detect if running inside a virtualenv so the wrapper uses the venv Python
    venv_dir = os.environ.get("VIRTUAL_ENV")
    if venv_dir:
        python_path = os.path.join(venv_dir, "bin", "python3")
        path_setup = f'PATH="{os.path.join(venv_dir, "bin")}:$PATH"'
    else:
        python_path = "python3"
        path_setup = ""

    ht_path.write_text(f"""#!/bin/sh
{path_setup}
exec "{python_path}" "{cli_path}" "$@"
""")
    ht_path.chmod(0o755)
    print(f"Installed ht to {ht_path}")
    if venv_dir:
        print(f"  Uses venv Python: {python_path}")
    print(f"Make sure {bin_dir} is in your PATH:")
    print(f"  export PATH=\"$PATH:{bin_dir}\"")
    print()
    check_ytdlp()


def cmd_init(args):
    """Interactive setup wizard."""
    config = load_config()

    print("HomeTube Setup\n")

    data_dir = input(f"Data directory [{config.get('data_dir', os.path.join(os.getcwd(), 'data'))}]: ").strip()
    config["data_dir"] = data_dir or config.get("data_dir", os.path.join(os.getcwd(), "data"))

    username = input(f"Default username [{config.get('active_user', '')}]: ").strip()
    if username:
        config["active_user"] = username

    print("\nMode:")
    print("  1) HTTP (local server)")
    print("  2) ngrok (public tunnel)")
    mode_choice = input("Choice [1]: ").strip() or "1"
    config["mode"] = {"1": "http", "2": "ngrok"}.get(mode_choice, "http")

    save_config(config)

    if username:
        db = get_db()
        try:
            from models import User
            user = db.query(User).filter(User.username == username).first()
            if not user:
                user = User(username=username)
                db.add(user)
                db.commit()
                print(f"Created user: {username}")
        finally:
            db.close()

    print("\nSetup complete!")
    print(f"  Data directory: {config['data_dir']}")
    print(f"  Default user: {config.get('active_user', '(none)')}")
    print(f"  Mode: {config['mode']}")


def cmd_login(args):
    """Switch active user, creating if needed."""
    db = get_db()
    try:
        from models import User
        user = db.query(User).filter(User.username == args.username).first()
        if not user:
            create = args.yes
            if not create:
                resp = input(f"User '{args.username}' does not exist. Create? [Y/n]: ").strip().lower()
                create = resp != "n"
            if not create:
                print("Aborted.")
                return
            user = User(username=args.username)
            db.add(user)
            db.commit()
            print(f"Created user: {args.username}")

        config = load_config()
        config["active_user"] = args.username
        save_config(config)
        print(f"Switched to user: {args.username}")
    finally:
        db.close()


def clean_title(title):
    if not title:
        return title
    return re.sub(r'\s*\[[^\]]+\]\s*$', '', title)


def cmd_download(args):
    """Download video/music/playlist from a URL."""
    if not check_ytdlp():
        sys.exit(1)

    db = get_db()
    try:
        from models import User, Video, Music, Playlist
        from services import ytdlp

        user = get_active_user(db)
        if not user:
            print("Error: No active user. Use 'ht login <username>' first.", file=sys.stderr)
            sys.exit(1)

        print(f"Fetching info for: {args.url}")
        import subprocess
        try:
            info = ytdlp.get_music_info(args.url)
        except subprocess.TimeoutExpired as e:
            err = (e.stderr or "").strip()
            print("Error: yt-dlp timed out (120s).", file=sys.stderr)
            if err:
                print(f"  yt-dlp output: {err}", file=sys.stderr)
            sys.exit(1)
        if not info:
            print("Error: Could not fetch URL info", file=sys.stderr)
            sys.exit(1)

        is_playlist = "entries" in info and info["entries"]

        if is_playlist:
            entries = [e for e in info["entries"] if e and e.get("id")]
            if not entries:
                print("Error: Empty playlist", file=sys.stderr)
                sys.exit(1)

            is_ytmusic = "music.youtube.com" in args.url
            content_type = args.type or ("music" if is_ytmusic or entries[0].get("artist") or entries[0].get("album") or entries[0].get("track") else "video")

            if content_type == "video":
                print(f"Adding {len(entries)} videos...")
                for entry in entries:
                    entry_url = entry.get("webpage_url") or entry.get("url") or f"https://www.youtube.com/watch?v={entry.get('id')}"
                    existing = db.query(Video).filter(Video.video_id == entry["id"]).first()
                    if existing:
                        print(f"  Exists: {entry.get('title', entry['id'])}")
                        continue
                    vid = Video(video_id=entry["id"], title=entry.get("title"), url=entry_url, added_by=user.id, quality=args.quality)
                    db.add(vid)
                    db.flush()
                    print(f"  Added: {entry.get('title', entry['id'])}")
                    if args.download:
                        ytdlp.download_video(entry_url, vid.id, args.quality)
                        vid.downloaded = True
                        print(f"  Downloaded: {entry.get('title', entry['id'])}")
                db.commit()
                print(f"\nAdded {len(entries)} videos.")
            else:
                playlist_name = args.playlist or info.get("title", "").strip() or "New Playlist"
                playlist = db.query(Playlist).filter(Playlist.name == playlist_name, Playlist.user_id == user.id).first()
                if not playlist:
                    playlist = Playlist(name=playlist_name, user_id=user.id)
                    db.add(playlist)
                    db.flush()
                    print(f"Created playlist: {playlist.name}")
                else:
                    print(f"Adding to playlist: {playlist.name}")

                print(f"Downloading {len(entries)} tracks...")
                for entry in entries:
                    if not entry.get("id"):
                        continue
                    title = clean_title(entry.get("title", "Unknown"))
                    artist = entry.get("artist") or entry.get("channel") or entry.get("uploader")
                    album_art = ytdlp.pick_album_art(entry) or ytdlp.pick_album_art(info)
                    entry_url = entry.get("webpage_url") or entry.get("url") or f"https://www.youtube.com/watch?v={entry.get('id')}"
                    existing = db.query(Music).filter(Music.video_id == entry["id"]).first()
                    if existing:
                        playlist_ids = [s["music_id"] for s in (playlist.songs or [])]
                        if existing.id not in playlist_ids:
                            songs = list(playlist.songs or [])
                            songs.append({"music_id": existing.id, "position": len(songs)})
                            playlist.songs = songs
                            print(f"  Added existing: {title}")
                        else:
                            print(f"  Already in playlist: {title}")
                        continue
                    music = Music(video_id=entry["id"], url=entry_url, title=title, artist=artist, album_art=album_art, added_by=user.id)
                    db.add(music)
                    db.flush()
                    filename = ytdlp.download_music(entry_url, music.id)
                    music.filename = filename
                    music.downloaded = True
                    db.flush()
                    songs = list(playlist.songs or [])
                    songs.append({"music_id": music.id, "position": len(songs)})
                    playlist.songs = songs
                    print(f"  Downloaded: {title}")
                db.commit()
                print(f"\nDownloaded {len(entries)} tracks to '{playlist.name}'.")
        else:
            is_ytmusic = "music.youtube.com" in args.url
            content_type = args.type or ("music" if is_ytmusic or info.get("artist") or info.get("album") or info.get("track") else "video")

            if content_type == "video":
                existing = db.query(Video).filter(Video.video_id == info.get("id")).first()
                if existing:
                    print(f"Video already exists: {existing.title}")
                else:
                    vid = Video(video_id=info.get("id"), title=info.get("title"), url=info.get("webpage_url") or args.url, added_by=user.id, quality=args.quality)
                    db.add(vid)
                    db.flush()
                    if args.download:
                        ytdlp.download_video(args.url, vid.id, args.quality)
                        vid.downloaded = True
                    db.commit()
                    print(f"Added video: {vid.title}")
            else:
                title = clean_title(info.get("title"))
                artist = info.get("artist") or info.get("channel") or info.get("uploader")
                existing = db.query(Music).filter(Music.video_id == info.get("id")).first()
                if existing:
                    print(f"Music already exists: {title}")
                else:
                    music = Music(video_id=info.get("id"), url=info.get("webpage_url") or args.url, title=title, artist=artist, album_art=ytdlp.pick_album_art(info), added_by=user.id)
                    db.add(music)
                    db.flush()
                    filename = ytdlp.download_music(args.url, music.id)
                    music.filename = filename
                    music.downloaded = True
                    db.commit()
                    print(f"Downloaded: {title}")

                    if args.playlist:
                        playlist = db.query(Playlist).filter(Playlist.name == args.playlist, Playlist.user_id == user.id).first()
                        if not playlist:
                            playlist = Playlist(name=args.playlist, user_id=user.id)
                            db.add(playlist)
                            db.flush()
                        songs = playlist.songs or []
                        songs.append({"music_id": music.id, "position": len(songs)})
                        playlist.songs = songs
                        db.commit()
                        print(f"Added to playlist: {playlist.name}")
    finally:
        db.close()


def update_ytdlp():
    """Update yt-dlp using the package manager it was installed with."""
    if not shutil.which("yt-dlp"):
        print("yt-dlp not found; skipped its update.")
        return

    if shutil.which("brew"):
        try:
            result = subprocess.run(
                ["brew", "list", "yt-dlp"], capture_output=True
            )
            if result.returncode == 0:
                print("Updating yt-dlp via Homebrew...")
                result = subprocess.run(["brew", "upgrade", "yt-dlp"])
                if result.returncode != 0:
                    print("Error: brew upgrade yt-dlp failed", file=sys.stderr)
                return
        except FileNotFoundError:
            pass

    pip_result = subprocess.run(
        [sys.executable, "-m", "pip", "show", "yt-dlp"],
        capture_output=True,
    )
    if pip_result.returncode == 0:
        print("Updating yt-dlp via pip...")
        result = subprocess.run(
            [sys.executable, "-m", "pip", "install", "-U", "yt-dlp[default]"],
        )
        if result.returncode != 0:
            print("Error: pip install yt-dlp failed", file=sys.stderr)
        return

    print("Updating yt-dlp...")
    result = subprocess.run(["yt-dlp", "-U"])
    if result.returncode != 0:
        print("Error: yt-dlp self-update failed", file=sys.stderr)


def cmd_update(args):
    """Pull latest from git and install dependencies."""
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if not os.path.isdir(os.path.join(repo_root, ".git")):
        print("Error: not a git repository — can't update", file=sys.stderr)
        sys.exit(1)

    print("Pulling latest from git...")
    result = subprocess.run(["git", "pull"], cwd=repo_root)
    if result.returncode != 0:
        print("Error: git pull failed", file=sys.stderr)
        sys.exit(1)

    req_file = os.path.join(repo_root, "backend", "requirements.txt")
    if os.path.exists(req_file):
        print("Installing Python dependencies...")
        result = subprocess.run(
            [sys.executable, "-m", "pip", "install", "-r", req_file],
        )
        if result.returncode != 0:
            print("Error: pip install failed", file=sys.stderr)
            sys.exit(1)

    update_ytdlp()
    check_js_runtime()

    print("Update complete.")


def cmd_export(args):
    """Export .ht file for the active user."""
    db = get_db()
    try:
        from models import User, Video, Music, Playlist, Channel, Subscription, Setting

        user = get_active_user(db)
        if not user:
            print("Error: No active user. Use 'ht login <username>' first.", file=sys.stderr)
            sys.exit(1)

        setup_paths()

        date_from = None
        now = datetime.utcnow()
        if args.day:
            date_from = now - timedelta(days=1)
        elif args.week:
            date_from = now - timedelta(days=7)
        elif args.month:
            date_from = now - timedelta(days=30)

        metadata = {"version": 1, "exported_at": now.isoformat()}

        metadata["users"] = [serialize_row(u) for u in db.query(User).filter(User.id == user.id).all()]

        metadata["channels"] = [serialize_row(c) for c in db.query(Channel).all()]

        metadata["subscriptions"] = [serialize_row(s) for s in db.query(Subscription).filter(Subscription.user_id == user.id).all()]

        q = db.query(Video).filter(Video.added_by == user.id)
        if date_from:
            q = q.filter(Video.created_at >= date_from)
        metadata["videos"] = [serialize_row(v) for v in q.all()]

        q = db.query(Music).filter(Music.added_by == user.id)
        if date_from:
            q = q.filter(Music.created_at >= date_from)
        music_rows = q.all()
        metadata["music"] = [serialize_row(m) for m in music_rows]

        playlist_rows = db.query(Playlist).filter(Playlist.user_id == user.id).all()
        metadata["playlists"] = [serialize_row(p) for p in playlist_rows]

        if args.playlist:
            playlist = _resolve_playlist(db, user.id, args.playlist)
            if not playlist:
                print(f"Error: Playlist not found: {args.playlist}", file=sys.stderr)
                sys.exit(1)
            song_ids = {s["music_id"] for s in (playlist.songs or [])}
            metadata["music"] = [m for m in metadata["music"] if m["id"] in song_ids]
            metadata["playlists"] = [serialize_row(playlist)]

        metadata["settings"] = [serialize_row(s) for s in db.query(Setting).all()]

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("metadata.json", json.dumps(metadata, default=str, indent=2))
            for v in metadata["videos"]:
                if v.get("downloaded") and v.get("video_id"):
                    fname = f"{v['video_id']}.mp4"
                    fpath = os.path.join(DL_DIR, "videos", fname)
                    if os.path.isfile(fpath):
                        zf.write(fpath, f"videos/{fname}")
            for m in metadata["music"]:
                fname = m.get("filename")
                if fname:
                    fpath = os.path.join(DL_DIR, "music", fname)
                    if os.path.isfile(fpath):
                        zf.write(fpath, f"music/{fname}")

        output = args.output or f"hometube-export-{now.strftime('%Y%m%d-%H%M%S')}.ht"
        with open(output, "wb") as f:
            f.write(buf.getvalue())

        counts = {k: len(metadata[k]) for k in ("users", "channels", "subscriptions", "videos", "music", "playlists")}
        print(f"Exported to {output}")
        print(f"  Users: {counts['users']}, Channels: {counts['channels']}, "
              f"Subscriptions: {counts['subscriptions']}, Videos: {counts['videos']}, "
              f"Music: {counts['music']}, Playlists: {counts['playlists']}")
    finally:
        db.close()


def cmd_import_music(args):
    """Import music files from a local folder."""
    folder = args.file or args.music
    if not folder or not os.path.isdir(folder):
        print(f"Error: folder not found: {folder}", file=sys.stderr)
        sys.exit(1)

    db = get_db()
    try:
        from models import User, Music, Playlist

        user = get_active_user(db)
        if not user:
            print("Error: No active user. Use 'ht login <username>' first.", file=sys.stderr)
            sys.exit(1)

        from import_music import extract_metadata

        # Resolve playlist by name
        playlist = None
        if args.playlist:
            playlist = db.query(Playlist).filter(Playlist.name == args.playlist, Playlist.user_id == user.id).first()
            if not playlist:
                playlist = Playlist(name=args.playlist, user_id=user.id)
                db.add(playlist)
                db.flush()
                print(f"Created playlist: {playlist.name}")

        setup_paths()

        SUPPORTED = {'.mp3', '.webm', '.flac', '.wav', '.m4a', '.ogg', '.aac'}
        existing_files = set(os.listdir(os.path.join(DL_DIR, "music")))
        imported = 0

        for root, _dirs, files in os.walk(folder):
            for fname in files:
                ext = Path(fname).suffix.lower()
                if ext not in SUPPORTED:
                    continue
                fpath = os.path.join(root, fname)

                meta = extract_metadata(fpath)

                dest = f"{meta['artist']} - {meta['title']}{ext}".replace("/", "-").replace("\\", "-")
                counter = 0
                orig = dest
                while dest in existing_files:
                    counter += 1
                    dest = f"{Path(orig).stem} ({counter}){ext}"
                existing_files.add(dest)

                dest_path = os.path.join(DL_DIR, "music", dest)
                if args.move:
                    shutil.move(fpath, dest_path)
                else:
                    shutil.copy2(fpath, dest_path)

                music = Music(
                    url=f"file://{dest}",
                    title=meta["title"],
                    artist=meta["artist"],
                    video_id=meta.get("video_id"),
                    filename=dest,
                    downloaded=True,
                    added_by=user.id,
                )
                db.add(music)
                db.flush()

                if playlist:
                    songs = list(playlist.songs or [])
                    songs.append({"music_id": music.id, "position": len(songs)})
                    playlist.songs = songs

                imported += 1
                print(f"  Imported: {meta['title']} by {meta['artist']}")

        db.commit()
        print(f"\nImported {imported} song(s).")
        if playlist:
            print(f"  Added to playlist: {playlist.name}")
    finally:
        db.close()


def cmd_import(args):
    """Import .ht archive."""
    if not args.file or not os.path.isfile(args.file):
        print(f"Error: file not found: {args.file}", file=sys.stderr)
        sys.exit(1)
    if not args.file.endswith(".ht"):
        print("Error: file must have .ht extension", file=sys.stderr)
        sys.exit(1)

    db = get_db()
    try:
        from models import User, Video, Music, Playlist, Channel, Subscription, Setting

        setup_paths()

        with zipfile.ZipFile(args.file, "r") as zf:
            if "metadata.json" not in zf.namelist():
                print("Error: invalid .ht file -- missing metadata.json", file=sys.stderr)
                sys.exit(1)

            with zf.open("metadata.json") as f:
                metadata = json.loads(f.read().decode("utf-8"))

            id_map = {}

            if "users" in metadata:
                id_map["users"] = {}
                for u in metadata["users"]:
                    existing = db.query(User).filter(User.username == u["username"]).first()
                    if existing:
                        id_map["users"][u["id"]] = existing.id
                        print(f"  User '{u['username']}' already exists (id {existing.id}), skipped")
                    else:
                        old_id = u["id"]
                        del u["id"]
                        new_u = User(**u)
                        db.add(new_u)
                        db.flush()
                        id_map["users"][old_id] = new_u.id
                        print(f"  Imported user: {new_u.username} (id {new_u.id})")

            if "channels" in metadata:
                id_map["channels"] = {}
                for c in metadata["channels"]:
                    old_id = c["id"]
                    del c["id"]
                    new_c = Channel(**c)
                    db.add(new_c)
                    db.flush()
                    id_map["channels"][old_id] = new_c.id
                    print(f"  Imported channel: {new_c.name or new_c.url} (id {new_c.id})")

            if "subscriptions" in metadata:
                id_map["subscriptions"] = {}
                for s in metadata["subscriptions"]:
                    old_id = s["id"]
                    del s["id"]
                    if s.get("channel_id") and s["channel_id"] in id_map.get("channels", {}):
                        s["channel_id"] = id_map["channels"][s["channel_id"]]
                    if s.get("user_id") and s["user_id"] in id_map.get("users", {}):
                        s["user_id"] = id_map["users"][s["user_id"]]
                    if s.get("last_checked"):
                        s["last_checked"] = datetime.fromisoformat(s["last_checked"]) if isinstance(s["last_checked"], str) else s["last_checked"]
                    if s.get("created_at"):
                        s["created_at"] = datetime.fromisoformat(s["created_at"]) if isinstance(s["created_at"], str) else s["created_at"]
                    new_s = Subscription(**s)
                    db.add(new_s)
                    db.flush()
                    id_map["subscriptions"][old_id] = new_s.id
                    print(f"  Imported subscription (id {new_s.id})")

            if "videos" in metadata:
                id_map["videos"] = {}
                for v in metadata["videos"]:
                    old_id = v["id"]
                    del v["id"]
                    if v.get("channel_id") and v["channel_id"] in id_map.get("channels", {}):
                        v["channel_id"] = id_map["channels"][v["channel_id"]]
                    if v.get("added_by") and v["added_by"] in id_map.get("users", {}):
                        v["added_by"] = id_map["users"][v["added_by"]]
                    if v.get("watched_at"):
                        v["watched_at"] = datetime.fromisoformat(v["watched_at"]) if isinstance(v["watched_at"], str) else v["watched_at"]
                    if v.get("created_at"):
                        v["created_at"] = datetime.fromisoformat(v["created_at"]) if isinstance(v["created_at"], str) else v["created_at"]
                    new_v = Video(**v)
                    db.add(new_v)
                    db.flush()
                    id_map["videos"][old_id] = new_v.id
                    print(f"  Imported video: {new_v.title} (id {new_v.id})")

            if "music" in metadata:
                id_map["music"] = {}
                for m in metadata["music"]:
                    old_id = m["id"]
                    del m["id"]
                    if m.get("added_by") and m["added_by"] in id_map.get("users", {}):
                        m["added_by"] = id_map["users"][m["added_by"]]
                    if m.get("created_at"):
                        m["created_at"] = datetime.fromisoformat(m["created_at"]) if isinstance(m["created_at"], str) else m["created_at"]
                    new_m = Music(**m)
                    db.add(new_m)
                    db.flush()
                    id_map["music"][old_id] = new_m.id
                    print(f"  Imported music: {new_m.title} (id {new_m.id})")

            if "playlists" in metadata:
                id_map["playlists"] = {}
                for p in metadata["playlists"]:
                    old_id = p["id"]
                    del p["id"]
                    if p.get("user_id") and p["user_id"] in id_map.get("users", {}):
                        p["user_id"] = id_map["users"][p["user_id"]]
                    if p.get("songs"):
                        new_songs = []
                        for song in p["songs"]:
                            s = dict(song)
                            if s.get("music_id") and s["music_id"] in id_map.get("music", {}):
                                s["music_id"] = id_map["music"][s["music_id"]]
                            new_songs.append(s)
                        p["songs"] = new_songs
                    if p.get("created_at"):
                        p["created_at"] = datetime.fromisoformat(p["created_at"]) if isinstance(p["created_at"], str) else p["created_at"]
                    new_p = Playlist(**p)
                    db.add(new_p)
                    db.flush()
                    id_map["playlists"][old_id] = new_p.id
                    print(f"  Imported playlist: {new_p.name} (id {new_p.id})")

            if "settings" in metadata:
                for s in metadata["settings"]:
                    if s.get("key") == "jwt_secret":
                        continue
                    existing = db.query(Setting).filter(Setting.key == s["key"]).first()
                    if not existing:
                        setting_data = {k: v for k, v in s.items() if k in ("key", "value")}
                        db.add(Setting(**setting_data))
                        print(f"  Imported setting: {s['key']}")

            os.makedirs(os.path.join(DL_DIR, "videos"), exist_ok=True)
            os.makedirs(os.path.join(DL_DIR, "music"), exist_ok=True)

            media_extracted = 0
            for name in zf.namelist():
                if name.startswith("videos/") and not name.endswith("/"):
                    zf.extract(name, DL_DIR)
                    media_extracted += 1
                    print(f"  Extracted video: {name}")
                elif name.startswith("music/") and not name.endswith("/"):
                    zf.extract(name, DL_DIR)
                    media_extracted += 1
                    print(f"  Extracted music: {name}")

            db.commit()

        print(f"\nImport complete!")
        print(f"  Users: {len(metadata.get('users', []))}")
        print(f"  Channels: {len(metadata.get('channels', []))}")
        print(f"  Subscriptions: {len(metadata.get('subscriptions', []))}")
        print(f"  Videos: {len(metadata.get('videos', []))}")
        print(f"  Music: {len(metadata.get('music', []))}")
        print(f"  Playlists: {len(metadata.get('playlists', []))}")
        print(f"  Media files extracted: {media_extracted}")
    except Exception as e:
        db.rollback()
        print(f"Import failed: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        db.close()


def cmd_songs(args):
    """List music for active user."""
    db = get_db()
    try:
        from models import Music

        user = get_active_user(db)
        if not user:
            print("Error: No active user. Use 'ht login <username>' first.", file=sys.stderr)
            sys.exit(1)

        songs = db.query(Music).filter(Music.added_by == user.id).order_by(Music.created_at.desc()).all()
        if not songs:
            print("No songs found.")
            return

        rows = [(s.id, (s.title or "")[:50], s.artist or "", "y" if s.downloaded else "n", s.created_at.strftime("%Y-%m-%d") if s.created_at else "") for s in songs]
        print_table(rows, ["ID", "Title", "Artist", "DL", "Date"])
    finally:
        db.close()


def cmd_playlists(args):
    """List playlists for active user."""
    db = get_db()
    try:
        from models import Playlist

        user = get_active_user(db)
        if not user:
            print("Error: No active user. Use 'ht login <username>' first.", file=sys.stderr)
            sys.exit(1)

        playlists = db.query(Playlist).filter(Playlist.user_id == user.id).order_by(Playlist.created_at.desc()).all()
        if not playlists:
            print("No playlists found.")
            return

        rows = [(p.id, p.name, len(p.songs) if p.songs else 0, p.created_at.strftime("%Y-%m-%d") if p.created_at else "") for p in playlists]
        print_table(rows, ["ID", "Name", "Songs", "Created"])
    finally:
        db.close()


def cmd_videos(args):
    """List videos for active user."""
    db = get_db()
    try:
        from models import Video

        user = get_active_user(db)
        if not user:
            print("Error: No active user. Use 'ht login <username>' first.", file=sys.stderr)
            sys.exit(1)

        videos = db.query(Video).filter(Video.added_by == user.id).order_by(Video.created_at.desc()).all()
        if not videos:
            print("No videos found.")
            return

        rows = []
        for v in videos:
            rows.append((v.id, (v.title or "")[:55], "y" if v.watched_at else "n", "y" if v.downloaded else "n", "y" if v.keep_flag else "", v.created_at.strftime("%Y-%m-%d") if v.created_at else ""))
        print_table(rows, ["ID", "Title", "Watched", "DL", "Keep", "Date"])
    finally:
        db.close()


def cmd_song_remove(args):
    db = get_db()
    try:
        from models import Music, Playlist
        user = get_active_user(db)
        if not user:
            print("Error: No active user. Use 'ht login <username>' first.", file=sys.stderr)
            sys.exit(1)
        music = _resolve_music(db, user.id, args.id_or_name)
        if not music:
            print(f"Error: Song not found: {args.id_or_name}", file=sys.stderr)
            sys.exit(1)
        playlists = db.query(Playlist).filter(Playlist.user_id == user.id).all()
        for pl in playlists:
            if pl.songs:
                pl.songs = [s for s in pl.songs if s.get("music_id") != music.id]
        if music.filename:
            fpath = os.path.join(DL_DIR, "music", music.filename)
            if os.path.isfile(fpath):
                os.remove(fpath)
        title = music.title
        db.delete(music)
        db.commit()
        print(f"Removed song: {title}")
    finally:
        db.close()


def cmd_video_remove(args):
    db = get_db()
    try:
        from models import Video
        user = get_active_user(db)
        if not user:
            print("Error: No active user. Use 'ht login <username>' first.", file=sys.stderr)
            sys.exit(1)
        video = _resolve_video(db, user.id, args.id_or_name)
        if not video:
            print(f"Error: Video not found: {args.id_or_name}", file=sys.stderr)
            sys.exit(1)
        if video.downloaded and video.video_id:
            fpath = os.path.join(DL_DIR, "videos", f"{video.video_id}.mp4")
            if os.path.isfile(fpath):
                os.remove(fpath)
        title = video.title
        db.delete(video)
        db.commit()
        print(f"Removed video: {title}")
    finally:
        db.close()


def cmd_playlist_remove(args):
    db = get_db()
    try:
        from models import Playlist
        user = get_active_user(db)
        if not user:
            print("Error: No active user. Use 'ht login <username>' first.", file=sys.stderr)
            sys.exit(1)
        playlist = _resolve_playlist(db, user.id, args.id_or_name)
        if not playlist:
            print(f"Error: Playlist not found: {args.id_or_name}", file=sys.stderr)
            sys.exit(1)
        name = playlist.name
        db.delete(playlist)
        db.commit()
        print(f"Removed playlist: {name}")
    finally:
        db.close()


def cmd_playlist_add(args):
    db = get_db()
    try:
        from models import Playlist
        user = get_active_user(db)
        if not user:
            print("Error: No active user. Use 'ht login <username>' first.", file=sys.stderr)
            sys.exit(1)
        existing = db.query(Playlist).filter(Playlist.name == args.name, Playlist.user_id == user.id).first()
        if existing:
            print(f"Playlist already exists: {args.name}")
            return
        playlist = Playlist(name=args.name, user_id=user.id)
        db.add(playlist)
        db.commit()
        print(f"Created playlist: {playlist.name} (id {playlist.id})")
    finally:
        db.close()


def cmd_playlist_update_add_song(args):
    db = get_db()
    try:
        from models import Playlist, Music
        user = get_active_user(db)
        if not user:
            print("Error: No active user. Use 'ht login <username>' first.", file=sys.stderr)
            sys.exit(1)
        playlist = _resolve_playlist(db, user.id, args.id_or_name)
        if not playlist:
            print(f"Error: Playlist not found: {args.id_or_name}", file=sys.stderr)
            sys.exit(1)
        music = _resolve_music(db, user.id, args.song_id_or_name)
        if not music:
            print(f"Error: Song not found: {args.song_id_or_name}", file=sys.stderr)
            sys.exit(1)
        songs = list(playlist.songs or [])
        music_ids = [s.get("music_id") for s in songs]
        if music.id in music_ids:
            print(f"Song already in playlist: {music.title}")
            return
        songs.append({"music_id": music.id, "position": len(songs)})
        playlist.songs = songs
        db.commit()
        print(f"Added '{music.title}' to playlist '{playlist.name}'")
    finally:
        db.close()


def cmd_playlist_update_remove_song(args):
    db = get_db()
    try:
        from models import Playlist, Music
        user = get_active_user(db)
        if not user:
            print("Error: No active user. Use 'ht login <username>' first.", file=sys.stderr)
            sys.exit(1)
        playlist = _resolve_playlist(db, user.id, args.id_or_name)
        if not playlist:
            print(f"Error: Playlist not found: {args.id_or_name}", file=sys.stderr)
            sys.exit(1)
        music = _resolve_music(db, user.id, args.song_id_or_name)
        if not music:
            print(f"Error: Song not found: {args.song_id_or_name}", file=sys.stderr)
            sys.exit(1)
        songs = list(playlist.songs or [])
        new_songs = [s for s in songs if s.get("music_id") != music.id]
        if len(new_songs) == len(songs):
            print(f"Song not in playlist: {music.title}")
            return
        playlist.songs = new_songs
        db.commit()
        print(f"Removed '{music.title}' from playlist '{playlist.name}'")
    finally:
        db.close()


def cmd_playlist_update_rename(args):
    db = get_db()
    try:
        from models import Playlist
        user = get_active_user(db)
        if not user:
            print("Error: No active user. Use 'ht login <username>' first.", file=sys.stderr)
            sys.exit(1)
        playlist = _resolve_playlist(db, user.id, args.id_or_name)
        if not playlist:
            print(f"Error: Playlist not found: {args.id_or_name}", file=sys.stderr)
            sys.exit(1)
        existing = db.query(Playlist).filter(Playlist.name == args.new_name, Playlist.user_id == user.id, Playlist.id != playlist.id).first()
        if existing:
            print(f"Another playlist already named '{args.new_name}' exists.")
            return
        old_name = playlist.name
        playlist.name = args.new_name
        db.commit()
        print(f"Renamed playlist '{old_name}' to '{playlist.name}'")
    finally:
        db.close()


def cmd_serve(args):
    """Start the HomeTube server."""
    import uvicorn

    backend_dir = os.path.dirname(os.path.abspath(__file__))
    if os.getcwd() != backend_dir:
        os.chdir(backend_dir)

    print(f"Starting HomeTube server on http://{args.host}:{args.port}")
    uvicorn.run("main:app", host=args.host, port=args.port, log_level=args.log_level)


REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _apk_path(variant):
    return os.path.join(
        REPO_ROOT, "mobile", "android", "app", "build", "outputs", "apk",
        variant, f"app-{variant}.apk",
    )


def cmd_build(args):
    """Build the Android app (release by default)."""
    mobile_dir = os.path.join(REPO_ROOT, "mobile")
    if not os.path.isdir(mobile_dir):
        print(f"Error: mobile directory not found: {mobile_dir}", file=sys.stderr)
        sys.exit(1)

    android_dir = os.path.join(mobile_dir, "android")
    if not os.path.isdir(android_dir):
        print("Generating Android project via expo prebuild...")
        result = subprocess.run(
            ["npx", "expo", "prebuild", "--platform", "android"],
            cwd=mobile_dir,
        )
        if result.returncode != 0:
            print("Error: expo prebuild failed", file=sys.stderr)
            sys.exit(1)

    variant = "debug" if args.debug else "release"
    task = f"assemble{variant.capitalize()}"
    print(f"Building Android app ({variant} variant)...")
    result = subprocess.run(["./gradlew", task], cwd=android_dir)
    if result.returncode != 0:
        print("Error: build failed", file=sys.stderr)
        sys.exit(1)

    apk = _apk_path(variant)
    print(f"Build complete: {apk}")
    print("Install it onto a connected device with: ht deploy")


def _find_adb():
    adb = shutil.which("adb")
    if adb:
        return adb
    for cand in (
        os.path.join(os.environ.get("ANDROID_HOME", ""), "platform-tools", "adb"),
        os.path.expanduser("~/Library/Android/sdk/platform-tools/adb"),
        os.path.expanduser("~/Android/Sdk/platform-tools/adb"),
    ):
        if cand and os.path.isfile(cand):
            return cand
    return None


def _connected_devices(adb):
    out = subprocess.run([adb, "devices"], capture_output=True, text=True).stdout
    devices = []
    for line in out.strip().splitlines()[1:]:
        parts = line.split()
        if len(parts) == 2 and parts[1] == "device":
            devices.append(parts[0])
    return devices


def cmd_deploy(args):
    """Install the built app onto a connected device via adb."""
    variant = "debug" if args.debug else "release"
    apk = _apk_path(variant)
    if not os.path.isfile(apk):
        print(f"APK not found: {apk}", file=sys.stderr)
        print("Build it first with: ht build", file=sys.stderr)
        sys.exit(1)

    adb = _find_adb()
    if not adb:
        print("Error: adb not found. Install Android Studio / platform-tools.", file=sys.stderr)
        sys.exit(1)

    devices = _connected_devices(adb)
    if not devices:
        print("No device connected. Enable USB debugging and connect your phone.", file=sys.stderr)
        sys.exit(1)

    target = args.device
    if target and target not in devices:
        print(f"Device not found: {target}", file=sys.stderr)
        print(f"Connected devices: {', '.join(devices) or '(none)'}", file=sys.stderr)
        sys.exit(1)
    if not target and len(devices) > 1:
        print(f"Multiple devices connected: {', '.join(devices)}", file=sys.stderr)
        print("Pick one with: ht deploy --device <serial>", file=sys.stderr)
        sys.exit(1)

    cmd = [adb, "install", "-r", apk]
    if target:
        cmd = [adb, "-s", target, "install", "-r", apk]
    else:
        cmd = [adb, "-s", devices[0], "install", "-r", apk]

    print(f"Installing {apk} onto {target or devices[0]}...")
    result = subprocess.run(cmd)
    if result.returncode != 0:
        print("Error: install failed", file=sys.stderr)
        sys.exit(1)
    print("Installed successfully.")


def cmd_fixart(args):
    """Backfill missing album art for downloaded music."""
    db = get_db()
    if args.data_dir:
        data_dir = os.path.abspath(args.data_dir)
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        from database import Base
        import models
        engine = create_engine(f"sqlite:///{os.path.join(data_dir, 'db.sqlite')}", connect_args={"check_same_thread": False})
        SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        Base.metadata.create_all(bind=engine)
        db = SessionLocal()
    try:
        from sqlalchemy import or_
        from concurrent.futures import ThreadPoolExecutor
        from models import Music
        from services import ytdlp

        missing = db.query(Music).filter(
            or_(Music.album_art.is_(None), Music.album_art == "")
        ).all()
        if not missing:
            print("No music is missing album art.")
            return

        print(f"Fetching album art for {len(missing)} tracks...", flush=True)

        def fetch(m):
            if not m.url:
                return m.id, None
            try:
                info = ytdlp.get_music_info(m.url)
                return m.id, ytdlp.pick_album_art(info) if info else None
            except Exception:
                return m.id, None

        fixed = 0
        with ThreadPoolExecutor(max_workers=4) as ex:
            for mid, art in ex.map(fetch, missing):
                if art:
                    row = db.query(Music).filter(Music.id == mid).first()
                    if row:
                        row.album_art = art
                        db.commit()
                        fixed += 1
                else:
                    print(f"  Skipped (no art found): id={mid}", flush=True)
        print(f"Updated {fixed} tracks.", flush=True)
    finally:
        db.close()


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="HomeTube CLI -- manage your HomeTube instance from the terminal.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("install", help="Install the ht command to ~/.local/bin")

    sub.add_parser("init", help="Interactive setup wizard")

    login_p = sub.add_parser("login", help="Switch active user (creates if not exists)")
    login_p.add_argument("username", help="Username")
    login_p.add_argument("--yes", "-y", action="store_true", help="Create user without prompting")

    dl_p = sub.add_parser("download", help="Download video/music/playlist from URL")
    dl_p.add_argument("url", help="URL to download")
    dl_p.add_argument("--type", choices=["video", "music"], help="Force content type (auto-detected by default)")
    dl_p.add_argument("--playlist", "-p", help="Playlist name to add music to")
    dl_p.add_argument("--quality", "-q", default="best", help="Video quality")
    dl_p.add_argument("--download", "-d", action="store_true", default=True, help="Download media (default: on)")
    dl_p.add_argument("--no-download", action="store_true", help="Add to DB only, skip download")

    export_p = sub.add_parser("export", help="Export .ht file for active user")
    export_p.add_argument("--output", "-o", help="Output .ht file path")
    export_p.add_argument("--day", action="store_true", help="Last 24 hours only")
    export_p.add_argument("--week", action="store_true", help="Last 7 days only")
    export_p.add_argument("--month", action="store_true", help="Last 30 days only")
    export_p.add_argument("--playlist", "-p", help="Export only songs from a specific playlist (ID or name)")

    import_p = sub.add_parser("import", help="Import .ht archive or music files from a folder")
    import_p.add_argument("file", nargs="?", help="Path to .ht file or music folder (with --music)")
    import_p.add_argument("--music", "-m", help="Import music files from a folder")
    import_p.add_argument("--playlist", "-p", help="Playlist name to add imported music to")
    import_p.add_argument("--move", action="store_true", help="Move files instead of copying (music import)")

    # songs
    songs_p = sub.add_parser("songs", help="List or manage songs")
    songs_sub = songs_p.add_subparsers(dest="songs_subcommand")
    songs_p.set_defaults(func=cmd_songs)
    songs_remove_p = songs_sub.add_parser("remove", help="Remove a song by ID or name")
    songs_remove_p.add_argument("id_or_name", help="Song ID or name")
    songs_remove_p.set_defaults(func=cmd_song_remove)

    # playlists
    playlists_p = sub.add_parser("playlists", help="List or manage playlists")
    playlists_sub = playlists_p.add_subparsers(dest="playlists_subcommand")
    playlists_p.set_defaults(func=cmd_playlists)
    playlists_remove_p = playlists_sub.add_parser("remove", help="Remove a playlist by ID or name")
    playlists_remove_p.add_argument("id_or_name", help="Playlist ID or name")
    playlists_remove_p.set_defaults(func=cmd_playlist_remove)
    playlists_add_p = playlists_sub.add_parser("add", help="Create a new playlist")
    playlists_add_p.add_argument("name", help="Playlist name")
    playlists_add_p.set_defaults(func=cmd_playlist_add)
    playlists_update_p = playlists_sub.add_parser("update", help="Update a playlist (add/remove songs, rename)")
    playlists_update_p.add_argument("id_or_name", help="Playlist ID or name")
    playlists_update_sub = playlists_update_p.add_subparsers(dest="playlists_update_action", required=True)
    pl_update_add = playlists_update_sub.add_parser("add", help="Add song to playlist")
    pl_update_add.add_argument("song_id_or_name", help="Song ID or name")
    pl_update_add.set_defaults(func=cmd_playlist_update_add_song)
    pl_update_remove = playlists_update_sub.add_parser("remove", help="Remove song from playlist")
    pl_update_remove.add_argument("song_id_or_name", help="Song ID or name")
    pl_update_remove.set_defaults(func=cmd_playlist_update_remove_song)
    pl_update_rename = playlists_update_sub.add_parser("rename", help="Rename playlist")
    pl_update_rename.add_argument("new_name", help="New playlist name")
    pl_update_rename.set_defaults(func=cmd_playlist_update_rename)

    # videos
    videos_p = sub.add_parser("videos", help="List or manage videos")
    videos_sub = videos_p.add_subparsers(dest="videos_subcommand")
    videos_p.set_defaults(func=cmd_videos)
    videos_remove_p = videos_sub.add_parser("remove", help="Remove a video by ID or name")
    videos_remove_p.add_argument("id_or_name", help="Video ID or name")
    videos_remove_p.set_defaults(func=cmd_video_remove)

    sub.add_parser("update", help="Pull latest from git and install dependencies")

    serve_p = sub.add_parser("serve", help="Start the HomeTube server")
    serve_p.add_argument("--host", default="0.0.0.0", help="Host to bind (default: 0.0.0.0)")
    serve_p.add_argument("--port", type=int, default=8000, help="Port to bind (default: 8000)")
    serve_p.add_argument("--log-level", choices=["debug", "info", "warning", "error", "critical"], default="info", help="Log level (default: info)")

    build_p = sub.add_parser("build", help="Build the Android app")
    build_p.add_argument("--debug", action="store_true", help="Build debug variant (default: release)")
    build_p.set_defaults(func=cmd_build)

    deploy_p = sub.add_parser("deploy", help="Install the built app onto a connected device")
    deploy_p.add_argument("--debug", action="store_true", help="Install the debug APK (default: release)")
    deploy_p.add_argument("--device", help="Device serial to install onto (see: adb devices)")
    deploy_p.set_defaults(func=cmd_deploy)

    fixart_p = sub.add_parser("fixart", help="Backfill missing album art for downloaded music")
    fixart_p.add_argument("--data-dir", help="Path to a data directory containing db.sqlite (default: configured data dir)")

    args = parser.parse_args()

    # Handle --no-download override
    if hasattr(args, "no_download") and args.no_download:
        args.download = False

    # Route import: --music flag triggers music folder import; otherwise .ht archive
    if args.command == "import" and args.music:
        cmd_import_music(args)
        return

    # Dispatch via func attribute (set by nested subparsers) or command dict
    if hasattr(args, "func"):
        args.func(args)
    else:
        cmds = {
            "install": cmd_install,
            "init": cmd_init,
            "login": cmd_login,
            "download": cmd_download,
            "export": cmd_export,
            "import": cmd_import,
            "update": cmd_update,
            "serve": cmd_serve,
            "fixart": cmd_fixart,
        }
        cmds[args.command](args)


if __name__ == "__main__":
    main()
