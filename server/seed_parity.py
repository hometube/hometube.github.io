"""Seed an identical library into DATA_DIR for the parity harness.

Run with backend/.venv + DATA_DIR set; imports the SQLAlchemy models so the
schema matches whatever the servers expect. Used to build two fresh, IDLEN-
tical copies (autoincrement ids included) before each parity run.
"""
import os
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend", "backend"))

import models  # noqa: E402
from database import Base, SessionLocal, engine  # noqa: E402

Base.metadata.create_all(bind=engine)
db = SessionLocal()


def set_setting(key: str, value: str) -> None:
    row = db.query(models.Setting).filter(models.Setting.key == key).first()
    if row:
        row.value = value
    else:
        db.add(models.Setting(key=key, value=value))

# Deterministic state: fixed clock so the two seeded copies are byte-equal,
# and a shared jwt_secret so tokens verified across both servers.
T0 = datetime(2026, 1, 1, 0, 0, 0)


def t(minutes):
    return T0 + timedelta(minutes=minutes)


set_setting("jwt_secret", "parity-secret-fixed-for-harness-only")

alice = models.User(username="alice")
bob = models.User(username="bob")
db.add_all([alice, bob])
db.flush()

redwall = models.Channel(url="https://example.com/redwall", name="Redwall")
music_ch = models.Channel(url="https://example.com/musicchan", name="MusicChan")
db.add_all([redwall, music_ch])
db.flush()

db.add(models.Subscription(channel_id=redwall.id, user_id=alice.id, kind="video", created_at=t(1)))
db.add(models.Subscription(channel_id=redwall.id, user_id=alice.id, kind="podcast", created_at=t(2)))

db.add_all(
    [
        models.Video(
            url="u1", title="Ep1", added_by=alice.id, channel_id=redwall.id,
            filename="ep1.mp4", downloaded=True, duration=120, thumbnail="http://x/t1.jpg", quality="best",
            created_at=t(3),
        ),
        models.Video(
            url="u2", title="Ep2 unwatched", added_by=bob.id, position=42.5,
            created_at=t(4),
        ),
        models.Video(
            url="u3", title="Ep3 kept", added_by=alice.id, keep_flag=True,
            created_at=t(5),
        ),
        models.Music(
            url="u4", title="Song A", artist="Band", added_by=alice.id,
            downloaded=True, filename="songa.mp3", created_at=t(6),
        ),
        models.Music(
            url="u5", title="Pod Ep", added_by=alice.id, channel_id=redwall.id,
            kind="podcast", downloaded=True, created_at=t(7),
        ),
    ]
)

pl = models.Playlist(name="Morning", user_id=alice.id, kind="music", created_at=t(8))
db.add(pl)
db.flush()
pl.songs = [{"music_id": 1, "position": 0}, {"music_id": 2, "position": 1}]

vpl = models.Playlist(name="Watch later", user_id=bob.id, kind="video", created_at=t(9))
db.add(vpl)
db.flush()
vpl.songs = [{"video_id": 1, "position": 0, "type": "video"}]

db.commit()
print("seeded", os.environ.get("DATA_DIR"))
