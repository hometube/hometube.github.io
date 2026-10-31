import os
from paths import downloads_dir

import yt_dlp

DL_DIR = downloads_dir()

# YouTube has been blocking the android_vr client (HTTP 403). Exclude it so
# yt-dlp uses the JS-capable web/web_safari clients instead.
#
# All yt-dlp access goes through its Python API: the old subprocess
# `[sys.executable, "-m", "yt_dlp"]` breaks in the frozen (PyInstaller)
# sidecar, where sys.executable is the app binary, not python.
def _ytdlp_params(**extra):
    params = {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "extractor_args": {"youtube": ["player_client=default,-android_vr"]},
    }
    params.update(extra)
    return params


def _entries_list(info):
    """Materialize playlist entries (generators) into a JSON-safe list."""
    entries = (info or {}).get("entries")
    if entries is None or isinstance(entries, list):
        return info
    out = dict(info)
    out["entries"] = [e for e in entries if e]
    return out


def get_video_info(url):
    try:
        with yt_dlp.YoutubeDL(_ytdlp_params(extract_flat=True)) as ydl:
            return _entries_list(ydl.extract_info(url, download=False))
    except Exception:
        return None

def get_available_formats(url):
    try:
        with yt_dlp.YoutubeDL(_ytdlp_params()) as ydl:
            data = ydl.extract_info(url, download=False)
    except Exception:
        return []
    try:
        formats = (data or {}).get("formats", [])
        seen = set()
        result = []
        for f in formats:
            if f.get("vcodec") == "none":
                continue
            height = f.get("height") or 0
            if height > 0 and height not in seen:
                seen.add(height)
                result.append({
                    "format_id": f.get("format_id"),
                    "height": height,
                    "ext": f.get("ext"),
                    "note": f.get("format_note", "")
                })
        result.sort(key=lambda x: x["height"], reverse=True)
        return result
    except:
        return []

def get_channel_videos(url):
    try:
        with yt_dlp.YoutubeDL(_ytdlp_params(extract_flat=True, ignoreerrors=True)) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception:
        return []
    entries = (info or {}).get("entries")
    if not entries:
        return []
    return [e for e in entries if e]

def get_music_info(url):
    return get_video_info(url)

def _is_jpg(url):
    return url.split("?", 1)[0].lower().endswith((".jpg", ".jpeg"))

def pick_album_art(info):
    """Best album art URL from a track info dict.

    yt-dlp's top-level `thumbnail` is usually the highest-preference entry,
    which today is a .webp URL -- and WebP art fails to render in several
    image loaders (mobile lock-screen/notification artwork, native Image
    components). Prefer the highest-preference .jpg thumbnail instead.
    """
    thumbs = info.get("thumbnails") or []
    jpgs = [t.get("url") for t in thumbs
            if isinstance(t, dict) and _is_jpg(t.get("url") or "")]
    if jpgs:
        # thumbnails are ordered by preference ascending; last is best
        return jpgs[-1]
    return info.get("thumbnail")

def pick_video_thumbnail(info):
    """Best thumbnail URL for a video (same jpg-preference rules as music)."""
    return pick_album_art(info)

def _file_ready(path):
    return bool(path) and os.path.exists(path) and os.path.getsize(path) > 0

def download_video(url, video_id, quality="best"):
    # API-based implementation (frozen-safe); same contract: returns the
    # stored filename.
    return download_video_with_progress(url, video_id, quality)

def download_music(url, music_id):
    return download_music_with_progress(url, music_id)

def _progress_hook(on_progress, kind):
    def hook(d):
        if on_progress is None:
            return
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            if total:
                pct = min(99, int(100 * d.get("downloaded_bytes", 0) / total))
                on_progress(pct, f"Downloading {kind} {pct}%")
            else:
                on_progress(0, f"Downloading {kind} (unknown size)")
        elif d.get("status") == "finished":
            on_progress(99, "Processing / merging")
    return hook

def download_video_with_progress(url, video_id, quality="best", on_progress=None):
    """Download a video with progress reporting. Returns the stored filename."""
    os.makedirs(f"{DL_DIR}/videos", exist_ok=True)
    fmt = quality if quality != "best" else "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"
    with yt_dlp.YoutubeDL(_ytdlp_params(
        format=fmt,
        outtmpl=f"{DL_DIR}/videos/%(id)s.%(ext)s",
        progress_hooks=[_progress_hook(on_progress, "video")],
    )) as ydl:
        info = ydl.extract_info(url, download=True)
    if on_progress:
        on_progress(99, "Finalizing")
    import glob
    base = (info or {}).get("id") or video_id
    matches = sorted(
        (m for m in glob.glob(f"{DL_DIR}/videos/{base}.*") if _file_ready(m)),
        key=os.path.getmtime,
    )
    if matches:
        return os.path.basename(matches[-1])
    path = ydl.prepare_filename(info) if info else None
    if _file_ready(path):
        return os.path.basename(path)
    raise RuntimeError(f"No video file produced for {url}")

def download_music_with_progress(url, music_id, on_progress=None):
    """Download music with progress reporting. Returns the stored filename."""
    os.makedirs(f"{DL_DIR}/music", exist_ok=True)
    with yt_dlp.YoutubeDL(_ytdlp_params(
        outtmpl=f"{DL_DIR}/music/%(id)s.%(ext)s",
        progress_hooks=[_progress_hook(on_progress, "music")],
        postprocessors=[
            {"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "0"},
            {"key": "EmbedThumbnail"},
        ],
        convert_thumbnails="jpg",
        writethumbnail=True,
    )) as ydl:
        info = ydl.extract_info(url, download=True)
    if on_progress:
        on_progress(99, "Finalizing")
    import glob
    base = (info or {}).get("id") or music_id
    matches = [m for m in (glob.glob(f"{DL_DIR}/music/{base}.mp3") or glob.glob(f"{DL_DIR}/music/{base}.*")) if _file_ready(m)]
    if matches:
        return os.path.basename(sorted(matches, key=os.path.getmtime)[-1])
    path = ydl.prepare_filename(info) if info else None
    if _file_ready(path):
        return os.path.basename(path)
    raise RuntimeError(f"No audio file produced for {url}")
