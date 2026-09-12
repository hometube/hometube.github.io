"""Background server-side download queue with progress reporting.

Downloads run on a thread pool so the /download API endpoints return
immediately (202 + job id) while yt-dlp works in the background.
Clients poll GET /api/downloads for job status/progress and receive the
final filename in the persisted DB row once the job completes.
"""
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import services.ytdlp as ytdlp
from database import SessionLocal
from models import Music, Video

_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="hometube-dl")
_REGISTRY: dict[str, dict] = {}
_LOCK = threading.Lock()


def _iso():
    return datetime.now(timezone.utc).isoformat()


def _write(job_id, **fields):
    with _LOCK:
        job = _REGISTRY.get(job_id)
        if job:
            job.update(fields)


def _fetch_url(kind, item_id):
    db = SessionLocal()
    try:
        row = db.query(Video if kind == "video" else Music).filter(
            (Video if kind == "video" else Music).id == item_id
        ).first()
        return row.url if row else None
    finally:
        db.close()


def _apply_to_db(kind, item_id, filename):
    db = SessionLocal()
    try:
        row = db.query(Video if kind == "video" else Music).filter(
            (Video if kind == "video" else Music).id == item_id
        ).first()
        if row:
            row.downloaded = True
            if filename and filename is not True:
                row.filename = filename
            db.commit()
    finally:
        db.close()


def _progress_for(job_id):
    def cb(pct, msg):
        if pct is not None:
            pending = {"progress": int(pct)}
        else:
            pending = {}
        pending["message"] = msg
        _write(job_id, **pending)

    return cb


def _run(job_id):
    with _LOCK:
        job = _REGISTRY.get(job_id)
        if not job:
            return
        kind, item_id = job["type"], job["item_id"]
        quality = job.get("quality", "best")
    _write(job_id, status="running", progress=1, message="Starting")
    try:
        url = _fetch_url(kind, item_id)
        if not url:
            raise RuntimeError("Item no longer exists")
        if kind == "video":
            filename = ytdlp.download_video_with_progress(
                url, item_id, quality, _progress_for(job_id)
            )
        else:
            filename = ytdlp.download_music_with_progress(url, item_id, _progress_for(job_id))
        _apply_to_db(kind, item_id, filename)
        _write(job_id, status="done", progress=100, message="Done", filename=filename)
    except Exception as exc:
        _write(job_id, status="error", message=str(exc), error=str(exc))


def start_video_download(video_id, user_id, quality="best"):
    return _start("video", video_id, user_id, quality=quality)


def start_music_download(music_id, user_id):
    return _start("music", music_id, user_id)


def _start(kind, item_id, user_id, quality=None):
    job_id = uuid.uuid4().hex[:12]
    job = {
        "id": job_id,
        "type": kind,
        "item_id": item_id,
        "user_id": user_id,
        "status": "queued",
        "progress": 0,
        "message": "Queued",
        "created_at": _iso(),
    }
    if quality is not None:
        job["quality"] = quality
    with _LOCK:
        _REGISTRY[job_id] = job
    _EXECUTOR.submit(_run, job_id)
    return job_id


def active_for(kind, item_id):
    with _LOCK:
        for job in _REGISTRY.values():
            if job["type"] == kind and job["item_id"] == item_id and job["status"] in ("queued", "running"):
                return dict(job)
    return None


def wait_for(kind, item_id, timeout=1800):
    """Block until a job for the item finishes. Returns the finished job dict or None."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        with _LOCK:
            job = next((dict(j) for j in _REGISTRY.values()
                        if j["type"] == kind and j["item_id"] == item_id
                        and j["status"] in ("queued", "running", "done", "error")), None)
        if job is None or job["status"] in ("done", "error"):
            return job
        time.sleep(0.5)
    return active_for(kind, item_id)


def list_jobs(user_id=None):
    with _LOCK:
        jobs = [dict(j) for j in _REGISTRY.values()]
    if user_id is not None:
        jobs = [j for j in jobs if j.get("user_id") == user_id]
    jobs.sort(key=lambda j: j.get("created_at") or "", reverse=True)
    for j in jobs:
        j.setdefault("filename", None)
        j.setdefault("error", None)
    return jobs