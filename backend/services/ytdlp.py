import subprocess, json, os, re
from paths import downloads_dir

DL_DIR = downloads_dir()

# YouTube has been blocking the android_vr client (HTTP 403). Exclude it so
# yt-dlp uses the JS-capable web/web_safari clients instead.
YTDLP_YT_ARGS = ["--extractor-args", "youtube:player_client=default,-android_vr"]

def run_ytdlp(args, capture=True, timeout=120):
    cmd = ["yt-dlp", "--no-warnings"] + YTDLP_YT_ARGS + args
    result = subprocess.run(cmd, capture_output=capture, text=True, timeout=timeout)
    return result.stdout if capture else result

def get_video_info(url):
    out = run_ytdlp(["--flat-playlist", "--dump-single-json", url])
    try:
        return json.loads(out)
    except:
        return None

def get_available_formats(url):
    out = run_ytdlp(["-J", url])
    try:
        data = json.loads(out)
        formats = data.get("formats", [])
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
    out = run_ytdlp(["--flat-playlist", url])
    videos = []
    for line in out.strip().split("\n"):
        if line:
            try:
                videos.append(json.loads(line))
            except:
                pass
    return videos

def get_music_info(url):
    out = run_ytdlp(["--flat-playlist", "--dump-single-json", url])
    try:
        return json.loads(out)
    except:
        return None

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

def download_video(url, video_id, quality="best"):
    os.makedirs(f"{DL_DIR}/videos", exist_ok=True)
    fmt = quality if quality != "best" else "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"
    cmd = ["yt-dlp"] + YTDLP_YT_ARGS + ["-f", fmt, "-o", f"{DL_DIR}/videos/%(id)s.%(ext)s", url]
    subprocess.run(cmd)
    return True

def download_music(url, music_id):
    os.makedirs(f"{DL_DIR}/music", exist_ok=True)
    out = run_ytdlp(["--get-filename", "-o", f"%(id)s.%(ext)s", url])
    expected_name = out.strip()
    # -x --audio-format mp3: opus/webm can't hold embedded cover art, and
    # .opus serves badly as audio/mpeg. mp3 is embeddable and plays everywhere.
    cmd = ["yt-dlp"] + YTDLP_YT_ARGS + [
        "-x",
        "--audio-format", "mp3",
        "--audio-quality", "0",
        "--embed-thumbnail",
        "--convert-thumbnails", "jpg",
        "-o", f"{DL_DIR}/music/%(id)s.%(ext)s",
        url,
    ]
    subprocess.run(cmd)
    import glob
    matches = glob.glob(f"{DL_DIR}/music/{expected_name.split('.')[0]}.*")
    if matches:
        return matches[0].split("/")[-1]
    return expected_name
