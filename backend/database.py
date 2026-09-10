from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base
import os
from paths import db_path

DB_PATH = db_path()
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def _ensure_column(db, table, column, ddl):
    rows = db.execute(text(f"PRAGMA table_info({table})")).fetchall()
    cols = {r[1] for r in rows}
    if column not in cols:
        db.execute(text(f"ALTER TABLE {table} ADD COLUMN {ddl}"))

def _ensure_columns(db):
    _ensure_column(db, "music", "kind", "kind VARCHAR(20) DEFAULT 'music'")
    _ensure_column(db, "music", "channel_id", "channel_id INTEGER")
    _ensure_column(db, "subscriptions", "kind", "kind VARCHAR(20) DEFAULT 'video'")
    _ensure_column(db, "playlists", "kind", "kind VARCHAR(20) DEFAULT 'music'")
    db.commit()

def ensure_schema():
    """Apply non-destructive schema migrations for existing SQLite databases.

    SQLAlchemy's create_all() does not ALTER existing tables, so new columns
    added to models.py are backfilled here for databases created before them.
    """
    from models import Base as ModelBase  # noqa: F401  (registers tables)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        _ensure_columns(db)
    finally:
        db.close()
