import json
import os
from pathlib import Path

CONFIG_FILE = Path.home() / ".config" / "hometube" / "config.json"


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