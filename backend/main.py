from fastapi import FastAPI, Depends, HTTPException, Request, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
import asyncio
import re
import os
import secrets
import zipfile
import io
import json
from contextlib import asynccontextmanager
import sys
import urllib.parse
import jwt
from datetime import datetime, timedelta

from database import engine, get_db, Base
import models
from services import ytdlp, scheduler


# Global variable to store the current ngrok token for display
current_ngrok_token = None
current_ngrok_url = None
jwt_secret = None


def get_jwt_secret(db: Session):
    """Get or create the JWT secret from the database"""
    global jwt_secret
    if jwt_secret:
        return jwt_secret

    setting = db.query(models.Setting).filter(models.Setting.key == "jwt_secret").first()
    if not setting:
        jwt_secret = secrets.token_urlsafe(64)
        setting = models.Setting(key="jwt_secret", value=jwt_secret)
        db.add(setting)
        db.commit()
    else:
        jwt_secret = setting.value
    return jwt_secret


def create_jwt_token(user_id: int, db: Session) -> str:
    """Create a JWT token for a user"""
    secret = get_jwt_secret(db)
    payload = {
        "user_id": user_id,
        "exp": datetime.utcnow() + timedelta(days=365),  # Long-lived token
        "iat": datetime.utcnow()
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def verify_jwt_token(token: str, db: Session):
    """Verify a JWT token and return the payload"""
    try:
        secret = get_jwt_secret(db)
        payload = jwt.decode(token, secret, algorithms=["HS256"])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


def clean_title(title):
    """Remove video ID from title (e.g., 'Song [video_id]' -> 'Song')"""
    if not title:
        return title
    return re.sub(r'\s*\[[^\]]+\]\s*$', '', title)

class UserCreate(BaseModel):
    username: str

class VideoAdd(BaseModel):
    url: str
    user_id: int
    quality: str = "best"

class ChannelAdd(BaseModel):
    url: str

class SubscribeReq(BaseModel):
    user_id: int
    criteria: dict = {}
    check_interval: int = 3600

class MusicAdd(BaseModel):
    url: str
    user_id: int
    playlist_id: Optional[int] = None

class MusicDownload(BaseModel):
    filename: Optional[str] = None

class PlaylistCreate(BaseModel):
    name: str
    user_id: int

class PlaylistRename(BaseModel):
    name: str

class PlaylistAddSong(BaseModel):
    music_id: int
    position: int = 0

class VideoWatch(BaseModel):
    watched: bool = True

class VideoKeep(BaseModel):
    keep: bool = True

class VideoUpdate(BaseModel):
    channel_id: Optional[int] = None
    added_by: Optional[int] = None

class MusicUpdate(BaseModel):
    added_by: Optional[int] = None

class PlaylistUpdate(BaseModel):
    name: Optional[str] = None
    user_id: Optional[int] = None

class ExportRequest(BaseModel):
    type: str = "all"
    user_id: Optional[int] = None
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    video_ids: Optional[List[int]] = None
    music_ids: Optional[List[int]] = None

Base.metadata.create_all(bind=engine)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize JWT secret and persistent ngrok token
    from sqlalchemy.orm import sessionmaker
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = SessionLocal()
    try:
        get_jwt_secret(db)

        # Load or create persistent ngrok token (only in dev mode)
        if len(sys.argv) > 1 and sys.argv[1] == "--dev":
            global current_ngrok_token
            token_setting = db.query(models.Setting).filter(models.Setting.key == "ngrok_token").first()
            if token_setting:
                current_ngrok_token = token_setting.value
            else:
                current_ngrok_token = secrets.token_urlsafe(32)
                token_setting = models.Setting(key="ngrok_token", value=current_ngrok_token)
                db.add(token_setting)
                db.commit()
    finally:
        db.close()

    # Start background subscription checker
    asyncio.create_task(scheduler.check_subscriptions())

    # If running locally (not in production), set up ngrok tunnel
    # Check if we're likely in a development environment
    if len(sys.argv) > 1 and sys.argv[1] == "--dev":
        try:
            from pyngrok import ngrok, conf

            # Get the port from environment or default to 8000
            port = int(os.environ.get("PORT", 8000))

            # Set auth token if available (optional for basic use)
            # ngrok.set_auth_token(os.environ.get("NGROK_AUTH_TOKEN", ""))

            # Open a ngrok tunnel to the HTTP port
            http_tunnel = ngrok.connect(port, "http")
            global current_ngrok_url
            current_ngrok_url = http_tunnel.public_url

            backend_param = f"{current_ngrok_url}/api?token={current_ngrok_token}"
            setup_url = f"https://hometube.github.io/setup?backend={urllib.parse.quote(backend_param, safe='')}"

            print("\n" + "="*60)
            print("🚀 HomeTube Development Server Ready!")
            print("="*60)
            print(f"Local API:     http://localhost:{port}")
            print(f"Public URL:    {current_ngrok_url}")
            print()
            print("📱 Open this URL to connect from anywhere:")
            print(f"   {setup_url}")
            print()

            try:
                import qrcode
                qr = qrcode.QRCode(border=1)
                qr.add_data(setup_url)
                qr.print_ascii(invert=True)
            except ImportError:
                print("   (install 'qrcode' package for a QR code)")

            print("="*60)
            print("Share the link above on any device to connect to")
            print("your HomeTube backend via GitHub Pages.")
            print("="*60 + "\n")
        except ImportError:
            print("⚠️  pyngrok not installed. Install with: pip install pyngrok")
            print("   Running in local-only mode.")
        except Exception as e:
            print(f"⚠️  Failed to start ngrok tunnel: {e}")
            print("   Running in local-only mode.")

    else:
        # Local-only mode: still print the setup URL
        port = int(os.environ.get("PORT", 8000))
        setup_url = f"https://hometube.github.io/setup?backend={urllib.parse.quote(f'http://localhost:{port}/api', safe='')}"

        print("\n" + "="*60)
        print("🚀 HomeTube Server Ready!")
        print("="*60)
        print(f"Local API:     http://localhost:{port}")
        print()
        print("📱 Local setup URL:")
        print(f"   {setup_url}")
        print()
        print("="*60 + "\n")

    yield

    # Clean up ngrok tunnel on shutdown
    if len(sys.argv) > 1 and sys.argv[1] == "--dev":
        try:
            from pyngrok import ngrok
            ngrok.kill()
        except:
            pass

app = FastAPI(lifespan=lifespan)

# CORS middleware - allow all origins since we use Bearer tokens (not cookies)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Force CORS headers on all responses (handles ngrok headers)
@app.middleware("http")
async def force_cors(request, call_next):
    response = await call_next(request)
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, ngrok-skip-browser-warning"
    return response

# Status endpoint - check backend connectivity (accepts JWT or ngrok token)
@app.get("/api/status")
def status(request: Request, db: Session = Depends(get_db)):
    global current_ngrok_token

    # If no ngrok token is set (production mode), always allow
    if not current_ngrok_token:
        return {"status": "ok", "version": "1.0"}

    # Get token from query params or Authorization header
    token = request.query_params.get('token', '')
    if not token and request.headers.get('authorization'):
        auth = request.headers.get('authorization')
        if auth.startswith('Bearer '):
            token = auth[7:]

    if not token:
        raise HTTPException(status_code=401, detail="Missing token")

    # Try JWT validation first
    try:
        verify_jwt_token(token, db)
        return {"status": "ok", "version": "1.0"}
    except HTTPException:
        pass

    # Fall back to ngrok token validation
    if token == current_ngrok_token:
        return {"status": "ok", "version": "1.0"}

    raise HTTPException(status_code=403, detail="Invalid token")

# Token exchange endpoint - use temporary ngrok token to get a long-lived JWT
@app.post("/api/auth/exchange")
def exchange_token(data: dict, db: Session = Depends(get_db)):
    global current_ngrok_token

    # Validate the temporary ngrok token
    token = data.get("token", "")
    if not current_ngrok_token or token != current_ngrok_token:
        raise HTTPException(status_code=403, detail="Invalid temporary token")

    # Get or create a system user for the JWT
    user = db.query(models.User).filter(models.User.username == "system").first()
    if not user:
        user = models.User(username="system")
        db.add(user)
        db.commit()
        db.refresh(user)

    # Create and return JWT
    jwt_token = create_jwt_token(user.id, db)
    return {"token": jwt_token, "token_type": "bearer"}

# Dependency to validate JWT token for protected endpoints
async def verify_token(request: Request, db: Session = Depends(get_db)):
    global current_ngrok_token

    # If no ngrok token is set (production mode), allow all
    if not current_ngrok_token:
        return True

    # Get token from query params or Authorization header
    token = None

    # Check query parameters first
    if request.query_params.get('token'):
        token = request.query_params.get('token')
    # Then check Authorization header
    elif request.headers.get('authorization'):
        auth_header = request.headers.get('authorization')
        if auth_header.startswith('Bearer '):
            token = auth_header[7:]  # Remove 'Bearer ' prefix

    if not token:
        raise HTTPException(status_code=401, detail="Missing token")

    # Try JWT validation first
    try:
        payload = verify_jwt_token(token, db)
        return payload
    except HTTPException:
        pass

    # Fall back to ngrok token validation
    if token == current_ngrok_token:
        return True

    raise HTTPException(status_code=403, detail="Invalid or missing token")

# Users
@app.get("/api/users")
def list_users(token_valid: bool = Depends(verify_token), db: Session = Depends(get_db)):
    return db.query(models.User).all()

@app.post("/api/users")
def create_user(data: UserCreate, token_valid: bool = Depends(verify_token), db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.username == data.username).first()
    if not user:
        user = models.User(username=data.username)
        db.add(user)
        db.commit()
        db.refresh(user)
    return user

# Channels
@app.post("/api/channels/add")
def add_channel(data: ChannelAdd, token_valid: bool = Depends(verify_token), db: Session = Depends(get_db)):
    info = ytdlp.get_video_info(data.url)
    if not info:
        raise HTTPException(400, "Invalid channel URL")
    chan = models.Channel(url=data.url, name=info.get("title", ""))
    db.add(chan)
    db.commit()
    db.refresh(chan)
    return chan

@app.get("/api/channels/{chan_id}/videos")
def get_channel_videos(chan_id: int, token_valid: bool = Depends(verify_token), db: Session = Depends(get_db)):
    chan = db.query(models.Channel).filter(models.Channel.id == chan_id).first()
    if not chan:
        raise HTTPException(404)
    videos = ytdlp.get_channel_videos(chan.url)
    return videos

@app.post("/api/channels/{chan_id}/subscribe")
def subscribe(chan_id: int, data: SubscribeReq, token_valid: bool = Depends(verify_token), db: Session = Depends(get_db)):
    sub = models.Subscription(channel_id=chan_id, user_id=data.user_id, criteria=data.criteria, check_interval=data.check_interval)
    db.add(sub)
    db.commit()
    return {"ok": True}

@app.delete("/api/subscriptions/{sub_id}")
def delete_subscription(sub_id: int, token_valid: bool = Depends(verify_token), db: Session = Depends(get_db)):
    sub = db.query(models.Subscription).filter(models.Subscription.id == sub_id).first()
    if not sub:
        raise HTTPException(404)
    db.delete(sub)
    db.commit()
    return {"ok": True}

# Videos
@app.post("/api/videos/add")
def add_video(data: VideoAdd, token_valid: bool = Depends(verify_token), db: Session = Depends(get_db)):
    info = ytdlp.get_video_info(data.url)
    if not info:
        raise HTTPException(400, "Invalid video URL")
    vid = models.Video(video_id=info.get("id"), title=info.get("title"), url=data.url, added_by=data.user_id, quality=data.quality)
    db.add(vid)
    db.commit()
    db.refresh(vid)
    return vid

@app.get("/api/videos")
def list_videos(user_id: int = None, filter: str = "all", token_valid: bool = Depends(verify_token), db: Session = Depends(get_db)):
    q = db.query(models.Video)
    if user_id:
        q = q.filter(models.Video.added_by == user_id)
    if filter == "unwatched":
        q = q.filter(models.Video.watched_at == None)
    return q.order_by(models.Video.created_at.desc()).all()

@app.post("/api/videos/{vid_id}/watch")
def watch_video(vid_id: int, data: VideoWatch, token_valid: bool = Depends(verify_token), db: Session = Depends(get_db)):
    vid = db.query(models.Video).filter(models.Video.id == vid_id).first()
    if not vid:
        raise HTTPException(404)
    from datetime import datetime
    vid.watched_at = datetime.utcnow() if data.watched else None
    db.commit()
    return {"ok": True}

@app.post("/api/videos/{vid_id}/keep")
def keep_video(vid_id: int, data: VideoKeep, token_valid: bool = Depends(verify_token), db: Session = Depends(get_db)):
    vid = db.query(models.Video).filter(models.Video.id == vid_id).first()
    if not vid:
        raise HTTPException(404)
    vid.keep_flag = data.keep
    db.commit()
    return {"ok": True}

@app.post("/api/videos/{vid_id}/download")
def download_video(vid_id: int, data: dict, token_valid: bool = Depends(verify_token), db: Session = Depends(get_db)):
    vid = db.query(models.Video).filter(models.Video.id == vid_id).first()
    if not vid:
        raise HTTPException(404)
    quality = data.get("quality", vid.quality or "best")
    ytdlp.download_video(vid.url, vid.id, quality)
    vid.downloaded = True
    db.commit()
    return {"ok": True}

@app.get("/api/videos/{vid_id}/qualities")
def get_video_qualities(vid_id: int, token_valid: bool = Depends(verify_token), db: Session = Depends(get_db)):
    vid = db.query(models.Video).filter(models.Video.id == vid_id).first()
    if not vid:
        raise HTTPException(404)
    return ytdlp.get_available_formats(vid.url)

@app.get("/api/videos/info")
def get_video_info_by_url(url: str, token_valid: bool = Depends(verify_token)):
    return ytdlp.get_available_formats(url)

@app.put("/api/videos/{vid_id}")
def update_video(vid_id: int, data: VideoUpdate, token_valid: bool = Depends(verify_token), db: Session = Depends(get_db)):
    vid = db.query(models.Video).filter(models.Video.id == vid_id).first()
    if not vid:
        raise HTTPException(404)
    if data.channel_id is not None:
        chan = db.query(models.Channel).filter(models.Channel.id == data.channel_id).first()
        if not chan:
            raise HTTPException(400, "Channel not found")
        vid.channel_id = data.channel_id
    if data.added_by is not None:
        user = db.query(models.User).filter(models.User.id == data.added_by).first()
        if not user:
            raise HTTPException(400, "User not found")
        vid.added_by = data.added_by
    db.commit()
    return vid

@app.delete("/api/videos/{vid_id}")
def delete_video(vid_id: int, token_valid: bool = Depends(verify_token), db: Session = Depends(get_db)):
    vid = db.query(models.Video).filter(models.Video.id == vid_id).first()
    if not vid:
        raise HTTPException(404)
    if vid.downloaded and vid.video_id:
        fname = f"data/downloads/videos/{vid.video_id}.mp4"
        if os.path.exists(fname):
            os.remove(fname)
    db.delete(vid)
    db.commit()
    return {"ok": True}

# Playlists
@app.get("/api/playlists")
def list_playlists(user_id: int = None, token_valid: bool = Depends(verify_token), db: Session = Depends(get_db)):
    q = db.query(models.Playlist)
    if user_id:
        q = q.filter(models.Playlist.user_id == user_id)
    return q.order_by(models.Playlist.created_at.desc()).all()

@app.post("/api/playlists")
def create_playlist(data: PlaylistCreate, token_valid: bool = Depends(verify_token), db: Session = Depends(get_db)):
    playlist = models.Playlist(name=data.name, user_id=data.user_id)
    db.add(playlist)
    db.commit()
    db.refresh(playlist)
    return playlist

@app.post("/api/playlists/{playlist_id}/add")
def add_to_playlist(playlist_id: int, data: PlaylistAddSong, token_valid: bool = Depends(verify_token), db: Session = Depends(get_db)):
    playlist = db.query(models.Playlist).filter(models.Playlist.id == playlist_id).first()
    if not playlist:
        raise HTTPException(404)
    songs = playlist.songs or []
    songs.append({"music_id": data.music_id, "position": data.position})
    playlist.songs = songs
    db.commit()
    return {"ok": True}

@app.delete("/api/playlists/{playlist_id}/remove/{music_id}")
def remove_from_playlist(playlist_id: int, music_id: int, token_valid: bool = Depends(verify_token), db: Session = Depends(get_db)):
    playlist = db.query(models.Playlist).filter(models.Playlist.id == playlist_id).first()
    if not playlist:
        raise HTTPException(404)
    playlist.songs = [s for s in (playlist.songs or []) if s.get("music_id") != music_id]
    db.commit()
    return {"ok": True}

@app.put("/api/playlists/{playlist_id}")
def update_playlist(playlist_id: int, data: PlaylistUpdate, token_valid: bool = Depends(verify_token), db: Session = Depends(get_db)):
    playlist = db.query(models.Playlist).filter(models.Playlist.id == playlist_id).first()
    if not playlist:
        raise HTTPException(404)
    if data.name is not None:
        playlist.name = data.name
    if data.user_id is not None:
        user = db.query(models.User).filter(models.User.id == data.user_id).first()
        if not user:
            raise HTTPException(400, "User not found")
        playlist.user_id = data.user_id
    db.commit()
    return playlist

@app.delete("/api/playlists/{playlist_id}")
def delete_playlist(playlist_id: int, token_valid: bool = Depends(verify_token), db: Session = Depends(get_db)):
    playlist = db.query(models.Playlist).filter(models.Playlist.id == playlist_id).first()
    if not playlist:
        raise HTTPException(404)
    db.delete(playlist)
    db.commit()
    return {"ok": True}

# Music
@app.get("/api/music/info")
def get_music_info_by_url(url: str, token_valid: bool = Depends(verify_token)):
    return ytdlp.get_music_info(url)

@app.post("/api/music/add")
def add_music(data: MusicAdd, token_valid: bool = Depends(verify_token), db: Session = Depends(get_db)):
    info = ytdlp.get_music_info(data.url)
    if not info:
        raise HTTPException(400, "Invalid music URL")

    if "entries" in info:
        entries = info.get("entries", [])
        if not entries:
            raise HTTPException(400, "Empty playlist")

        music_ids = []
        for entry in entries:
            if not entry or not entry.get("id"):
                continue
            title = clean_title(entry.get("title", "Unknown"))
            artist = entry.get("artist") or entry.get("channel") or entry.get("uploader")
            album_art = entry.get("thumbnail") or info.get("thumbnail")
            video_id = entry.get("id")
            entry_url = entry.get("webpage_url") or entry.get("url") or f"https://www.youtube.com/watch?v={video_id}"

            music = models.Music(
                video_id=video_id,
                url=entry_url,
                title=title,
                artist=artist,
                album_art=album_art,
                is_playlist=False,
                added_by=data.user_id
            )
            db.add(music)
            db.flush()
            filename = ytdlp.download_music(entry_url, music.id)
            music.filename = filename
            music.downloaded = True
            db.flush()
            music_ids.append(music.id)

        if data.playlist_id:
            playlist = db.query(models.Playlist).filter(models.Playlist.id == data.playlist_id).first()
            if playlist:
                songs = playlist.songs or []
                for mid in music_ids:
                    songs.append({"music_id": mid, "position": 0})
                playlist.songs = songs
        else:
            playlist_name = (info.get("title") or "New Playlist").strip()
            playlist = models.Playlist(name=playlist_name, user_id=data.user_id)
            db.add(playlist)
            db.flush()
            songs = [{"music_id": mid, "position": i} for i, mid in enumerate(music_ids)]
            playlist.songs = songs

        db.commit()
        return {"ok": True, "count": len(music_ids), "is_playlist": True, "playlist_id": playlist.id}

    title = clean_title(info.get("title"))
    music = models.Music(video_id=info.get("id"), url=data.url, title=title, artist=info.get("artist"), album_art=info.get("thumbnail"), is_playlist=False, added_by=data.user_id)
    db.add(music)
    db.commit()
    db.refresh(music)
    filename = ytdlp.download_music(music.url, music.id)
    music.filename = filename
    music.downloaded = True
    db.commit()
    if data.playlist_id:
        playlist = db.query(models.Playlist).filter(models.Playlist.id == data.playlist_id).first()
        if playlist:
            songs = playlist.songs or []
            songs.append({"music_id": music.id, "position": 0})
            playlist.songs = songs
            db.commit()
    return music

@app.get("/api/music")
def list_music(user_id: int = None, token_valid: bool = Depends(verify_token), db: Session = Depends(get_db)):
    q = db.query(models.Music)
    if user_id:
        q = q.filter(models.Music.added_by == user_id)
    return q.order_by(models.Music.created_at.desc()).all()

@app.post("/api/music/{music_id}/download")
def download_music(music_id: int, data: MusicDownload, token_valid: bool = Depends(verify_token), db: Session = Depends(get_db)):
    music = db.query(models.Music).filter(models.Music.id == music_id).first()
    if not music:
        raise HTTPException(404)
    filename = ytdlp.download_music(music.url, music.id)
    music.filename = filename
    music.downloaded = True
    db.commit()
    return {"ok": True, "filename": filename}

@app.get("/api/music/{music_id}/file")
def serve_music_by_id(music_id: int, token_valid: bool = Depends(verify_token), db: Session = Depends(get_db)):
    music = db.query(models.Music).filter(models.Music.id == music_id).first()
    if not music:
        raise HTTPException(404)

    print(f"[DEBUG] Serving music {music_id}: filename={music.filename}, video_id={music.video_id}, url={music.url}, title={music.title}")

    # Auto-download if not already downloaded
    if not music.downloaded or not music.filename or not os.path.exists(f"data/downloads/music/{music.filename}"):
        print(f"[DEBUG] Music not downloaded, triggering download...")
        filename = ytdlp.download_music(music.url, music.id)
        if filename:
            music.filename = filename
            music.downloaded = True
            db.commit()

    # Use stored filename if available
    if music.filename:
        path = f"data/downloads/music/{music.filename}"
        if os.path.exists(path):
            print(f"[DEBUG] Using stored filename: {path}")
            ext = music.filename.split(".")[-1].lower()
            media_types = {"mp3": "audio/mpeg", "webm": "audio/webm", "m4a": "audio/mp4", "ogg": "audio/ogg", "flac": "audio/flac", "wav": "audio/wav"}
            media_type = media_types.get(ext, "audio/mpeg")
            response = FileResponse(path, media_type=media_type, filename=music.filename)
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
            return response
        else:
            print(f"[DEBUG] Stored filename not found on disk: {path}")

    # Try to extract filename from URL (for imported files with file:// prefix)
    if music.url and music.url.startswith('file://'):
        filename = music.url[7:]  # Remove 'file://' prefix
        path = f"data/downloads/music/{filename}"
        if os.path.exists(path):
            print(f"[DEBUG] Using filename from URL: {path}")
            # Save filename to database for future use
            music.filename = filename
            db.commit()
            ext = filename.split(".")[-1].lower()
            media_types = {"mp3": "audio/mpeg", "webm": "audio/webm", "m4a": "audio/mp4", "ogg": "audio/ogg", "flac": "audio/flac", "wav": "audio/wav"}
            media_type = media_types.get(ext, "audio/mpeg")
            response = FileResponse(path, media_type=media_type, filename=filename)
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
            return response

    # Find file by video_id or other methods
    import glob
    import re
    video_id = music.video_id
    if not video_id and music.url:
        # Extract from YouTube URL
        match = re.search(r'[?&]v=([^&]+)', music.url)
        if not match:
            match = re.search(r'youtu\.be/([^?&]+)', music.url)
        if match:
            video_id = match.group(1)
    if not video_id and music.title:
        # Extract from title like "Song [video_id]"
        match = re.search(r'\[([^\]]+)\]', music.title)
        if match:
            video_id = match.group(1)
    if not video_id:
        video_id = str(music.id)

    print(f"[DEBUG] Searching for video_id: {video_id}")
    matches = glob.glob(f"data/downloads/music/*{video_id}*")
    print(f"[DEBUG] Glob matches: {matches}")
    if not matches:
        raise HTTPException(404)
    path = matches[0]
    filename = path.split("/")[-1]

    # Save filename to database for future use
    music.filename = filename
    db.commit()

    ext = filename.split(".")[-1].lower()
    media_types = {"mp3": "audio/mpeg", "webm": "audio/webm", "m4a": "audio/mp4", "ogg": "audio/ogg", "flac": "audio/flac", "wav": "audio/wav"}
    media_type = media_types.get(ext, "audio/mpeg")
    response = FileResponse(path, media_type=media_type, filename=filename)
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

@app.delete("/api/music/{music_id}")
def delete_music(music_id: int, token_valid: bool = Depends(verify_token), db: Session = Depends(get_db)):
    music = db.query(models.Music).filter(models.Music.id == music_id).first()
    if not music:
        raise HTTPException(404)

    # Remove from all playlists
    playlists = db.query(models.Playlist).all()
    for pl in playlists:
        if pl.songs:
            pl.songs = [s for s in pl.songs if s.get("music_id") != music_id]

    # Delete file from disk
    if music.filename:
        path = f"data/downloads/music/{music.filename}"
        if os.path.exists(path):
            os.remove(path)

    db.delete(music)
    db.commit()
    return {"ok": True}

@app.put("/api/music/{music_id}")
def update_music(music_id: int, data: MusicUpdate, token_valid: bool = Depends(verify_token), db: Session = Depends(get_db)):
    music = db.query(models.Music).filter(models.Music.id == music_id).first()
    if not music:
        raise HTTPException(404)
    if data.added_by is not None:
        user = db.query(models.User).filter(models.User.id == data.added_by).first()
        if not user:
            raise HTTPException(400, "User not found")
        music.added_by = data.added_by
    db.commit()
    return music

# Export / Import
def serialize_row(obj):
    d = {}
    for col in obj.__table__.columns:
        val = getattr(obj, col.name)
        if isinstance(val, datetime):
            val = val.isoformat()
        d[col.name] = val
    return d

@app.post("/api/export")
def export_data(data: ExportRequest, token_valid: bool = Depends(verify_token), db: Session = Depends(get_db)):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:

        metadata = {"version": 1, "exported_at": datetime.utcnow().isoformat()}

        q = db.query(models.User)
        if data.user_id:
            q = q.filter(models.User.id == data.user_id)
        metadata["users"] = [serialize_row(u) for u in q.all()]

        q = db.query(models.Channel)
        metadata["channels"] = [serialize_row(c) for c in q.all()]

        q = db.query(models.Subscription)
        if data.user_id:
            q = q.filter(models.Subscription.user_id == data.user_id)
        metadata["subscriptions"] = [serialize_row(s) for s in q.all()]

        q = db.query(models.Video)
        if data.user_id:
            q = q.filter(models.Video.added_by == data.user_id)
        if data.type == "videos" or data.type == "all":
            if data.video_ids:
                q = q.filter(models.Video.id.in_(data.video_ids))
            if data.date_from:
                q = q.filter(models.Video.created_at >= datetime.fromisoformat(data.date_from))
            if data.date_to:
                q = q.filter(models.Video.created_at <= datetime.fromisoformat(data.date_to))
        else:
            q = q.filter(False)
        metadata["videos"] = [serialize_row(v) for v in q.all()]

        q = db.query(models.Music)
        if data.user_id:
            q = q.filter(models.Music.added_by == data.user_id)
        if data.type == "music" or data.type == "all":
            if data.music_ids:
                q = q.filter(models.Music.id.in_(data.music_ids))
            if data.date_from:
                q = q.filter(models.Music.created_at >= datetime.fromisoformat(data.date_from))
            if data.date_to:
                q = q.filter(models.Music.created_at <= datetime.fromisoformat(data.date_to))
        else:
            q = q.filter(False)
        metadata["music"] = [serialize_row(m) for m in q.all()]

        q = db.query(models.Playlist)
        if data.user_id:
            q = q.filter(models.Playlist.user_id == data.user_id)
        metadata["playlists"] = [serialize_row(p) for p in q.all()]

        q = db.query(models.Setting)
        metadata["settings"] = [serialize_row(s) for s in q.all()]

        zf.writestr("metadata.json", json.dumps(metadata, default=str, indent=2))

        for v in metadata["videos"]:
            if v.get("downloaded") and v.get("video_id"):
                fname = f"{v['video_id']}.mp4"
                fpath = f"data/downloads/videos/{fname}"
                if os.path.isfile(fpath):
                    zf.write(fpath, f"videos/{fname}")

        for m in metadata["music"]:
            fname = m.get("filename")
            if fname:
                fpath = f"data/downloads/music/{fname}"
                if os.path.isfile(fpath):
                    zf.write(fpath, f"music/{fname}")

    buf.seek(0)
    filename = f"hometube-export-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}.ht"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )

@app.post("/api/import")
async def import_data(file: UploadFile = File(...), token_valid: bool = Depends(verify_token), db: Session = Depends(get_db)):
    if not file.filename.endswith(".ht"):
        raise HTTPException(400, "File must have .ht extension")

    contents = await file.read()
    buf = io.BytesIO(contents)
    summary = {"users": 0, "channels": 0, "subscriptions": 0, "videos": 0, "music": 0, "playlists": 0}

    try:
        with zipfile.ZipFile(buf, 'r') as zf:
            if "metadata.json" not in zf.namelist():
                raise HTTPException(400, "Invalid .ht file: missing metadata.json")

            with zf.open("metadata.json") as f:
                metadata = json.loads(f.read().decode("utf-8"))

            id_map = {}  # old_id -> new_id per table

            if "users" in metadata:
                id_map["users"] = {}
                for u in metadata["users"]:
                    existing = db.query(models.User).filter(models.User.username == u["username"]).first()
                    if existing:
                        id_map["users"][u["id"]] = existing.id
                    else:
                        old_id = u["id"]
                        del u["id"]
                        new_u = models.User(**u)
                        db.add(new_u)
                        db.flush()
                        id_map["users"][old_id] = new_u.id
                        summary["users"] += 1

            if "channels" in metadata:
                id_map["channels"] = {}
                for c in metadata["channels"]:
                    old_id = c["id"]
                    del c["id"]
                    new_c = models.Channel(**c)
                    db.add(new_c)
                    db.flush()
                    id_map["channels"][old_id] = new_c.id
                    summary["channels"] += 1

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
                    new_s = models.Subscription(**s)
                    db.add(new_s)
                    db.flush()
                    id_map["subscriptions"][old_id] = new_s.id
                    summary["subscriptions"] += 1

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
                    new_v = models.Video(**v)
                    db.add(new_v)
                    db.flush()
                    id_map["videos"][old_id] = new_v.id
                    summary["videos"] += 1

            if "music" in metadata:
                id_map["music"] = {}
                for m in metadata["music"]:
                    old_id = m["id"]
                    del m["id"]
                    if m.get("added_by") and m["added_by"] in id_map.get("users", {}):
                        m["added_by"] = id_map["users"][m["added_by"]]
                    if m.get("created_at"):
                        m["created_at"] = datetime.fromisoformat(m["created_at"]) if isinstance(m["created_at"], str) else m["created_at"]
                    new_m = models.Music(**m)
                    db.add(new_m)
                    db.flush()
                    id_map["music"][old_id] = new_m.id
                    summary["music"] += 1

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
                    new_p = models.Playlist(**p)
                    db.add(new_p)
                    db.flush()
                    id_map["playlists"][old_id] = new_p.id
                    summary["playlists"] += 1

            os.makedirs("data/downloads/videos", exist_ok=True)
            os.makedirs("data/downloads/music", exist_ok=True)

            for name in zf.namelist():
                if name.startswith("videos/") and not name.endswith("/"):
                    zf.extract(name, "data/downloads")
                elif name.startswith("music/") and not name.endswith("/"):
                    zf.extract(name, "data/downloads")

            if "settings" in metadata:
                for s in metadata["settings"]:
                    if s.get("key") == "jwt_secret":
                        continue
                    existing = db.query(models.Setting).filter(models.Setting.key == s["key"]).first()
                    if not existing:
                        setting_data = {k: v for k, v in s.items() if k in ("key", "value")}
                        db.add(models.Setting(**setting_data))

        db.commit()
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(400, f"Import failed: {str(e)}")

    return {"ok": True, "summary": summary}

# Downloads status
@app.get("/api/downloads")
def list_downloads(user_id: int = None, token_valid: bool = Depends(verify_token), db: Session = Depends(get_db)):
    q = db.query(models.Download)
    if user_id:
        q = q.filter(models.Download.user_id == user_id)
    return q.order_by(models.Download.created_at.desc()).all()

# Serve downloaded files
import os
from fastapi.responses import FileResponse

@app.get("/api/files/videos/{filename:path}")
def serve_video(filename: str, token_valid: bool = Depends(verify_token)):
    path = f"data/downloads/videos/{filename}"
    if not os.path.exists(path):
        raise HTTPException(404)
    return FileResponse(path, media_type="video/mp4", filename=filename)

@app.get("/api/files/music/{filename:path}")
def serve_music(filename: str, token_valid: bool = Depends(verify_token)):
    path = f"data/downloads/music/{filename}"
    if not os.path.exists(path):
        raise HTTPException(404)
    ext = filename.split(".")[-1].lower()
    media_types = {"mp3": "audio/mpeg", "webm": "audio/webm", "m4a": "audio/mp4", "ogg": "audio/ogg", "flac": "audio/flac", "wav": "audio/wav"}
    media_type = media_types.get(ext, "audio/mpeg")
    return FileResponse(path, media_type=media_type, filename=filename)

# Serve frontend
frontend_dist = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend", "dist")

@app.get("/{fullpath:path}")
async def serve_spa(fullpath: str):
    # Try to serve static file first
    file_path = os.path.join(frontend_dist, fullpath)
    print(f"[DEBUG] serve_spa: fullpath='{fullpath}', file_path='{file_path}', exists={os.path.isfile(file_path)}")
    if os.path.isfile(file_path):
        return FileResponse(file_path)
    # SPA fallback - return index.html for client-side routing
    index_path = os.path.join(frontend_dist, "index.html")
    print(f"[DEBUG] serve_spa fallback: index_path='{index_path}', exists={os.path.isfile(index_path)}")
    if os.path.isfile(index_path):
        return FileResponse(index_path)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
    raise HTTPException(404)
