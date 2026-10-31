import json
import os
import sys
from pathlib import Path

CONFIG_FILE = Path.home() / ".config" / "hometube" / "config.json"


def ensure_tool_path():
    """Make ffmpeg / JS runtimes findable in GUI launch contexts.

    Finder-launched macOS apps (and some service managers) start with a
    minimal PATH that excludes Homebrew/winget locations, so shutil.which
    and yt-dlp can't see ffmpeg or deno even when installed. Prepend the
    standard install dirs (idempotent).
    """
    if sys.platform == "darwin":
        candidates = ["/opt/homebrew/bin", "/usr/local/bin"]
    elif sys.platform == "win32":
        local = os.environ.get("LOCALAPPDATA", "")
        candidates = [
            os.path.join(local, "Microsoft", "WinGet", "Links") if local else "",
            r"C:\ProgramData\chocolatey\bin",
        ]
    else:
        candidates = ["/usr/local/bin", os.path.expanduser("~/.local/bin")]
    path_dirs = os.environ.get("PATH", "").split(os.pathsep)
    add = [c for c in candidates if c and os.path.isdir(c) and c not in path_dirs]
    if add:
        os.environ["PATH"] = os.pathsep.join(add + path_dirs)


def load_config():
    if CONFIG_FILE.exists():
        try:
            return json.loads(CONFIG_FILE.read_text())
        except Exception:
            return {}
    return {}


def data_dir():
    d = os.environ.get("DATA_DIR") or load_config().get("data_dir") or "data"
    return os.path.abspath(d)


def db_path():
    return os.environ.get("DB_PATH") or os.path.join(data_dir(), "db.sqlite")


def downloads_dir():
    return os.environ.get("DL_DIR") or os.path.join(data_dir(), "downloads")