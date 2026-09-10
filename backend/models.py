from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text, JSON, Table
from sqlalchemy.sql import func
from database import Base

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    username = Column(String(50), unique=True, nullable=False)

class Channel(Base):
    __tablename__ = "channels"
    id = Column(Integer, primary_key=True)
    url = Column(String(500), nullable=False)
    name = Column(String(200))

class Subscription(Base):
    __tablename__ = "subscriptions"
    id = Column(Integer, primary_key=True)
    channel_id = Column(Integer, ForeignKey("channels.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    criteria = Column(JSON)
    check_interval = Column(Integer, default=3600)
    kind = Column(String(20), default="video", server_default="video")
    last_checked = Column(DateTime)
    created_at = Column(DateTime, server_default=func.now())

playlist_music = Table(
    'playlist_music', Base.metadata,
    Column('playlist_id', Integer, ForeignKey('playlists.id'), primary_key=True),
    Column('music_id', Integer, ForeignKey('music.id'), primary_key=True),
    Column('position', Integer, default=0)
)

class Playlist(Base):
    __tablename__ = "playlists"
    id = Column(Integer, primary_key=True)
    name = Column(String(200), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"))
    kind = Column(String(20), default="music", server_default="music")
    created_at = Column(DateTime, server_default=func.now())
    songs = Column(JSON, default=[])

class Video(Base):
    __tablename__ = "videos"
    id = Column(Integer, primary_key=True)
    video_id = Column(String(20))
    title = Column(String(300))
    channel_id = Column(Integer, ForeignKey("channels.id"))
    url = Column(String(500))
    downloaded = Column(Boolean, default=False)
    added_by = Column(Integer, ForeignKey("users.id"))
    watched_at = Column(DateTime, nullable=True)
    keep_flag = Column(Boolean, default=False)
    quality = Column(String(20), default="best")
    created_at = Column(DateTime, server_default=func.now())

class Music(Base):
    __tablename__ = "music"
    id = Column(Integer, primary_key=True)
    video_id = Column(String(20))
    url = Column(String(500))
    title = Column(String(300))
    artist = Column(String(200))
    album_art = Column(String(500))
    channel_id = Column(Integer, ForeignKey("channels.id"))
    filename = Column(String(500))
    is_playlist = Column(Boolean, default=False)
    playlist_id = Column(String(50))
    kind = Column(String(20), default="music", server_default="music")
    downloaded = Column(Boolean, default=False)
    added_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, server_default=func.now())

class Download(Base):
    __tablename__ = "downloads"
    id = Column(Integer, primary_key=True)
    type = Column(String(10))
    item_id = Column(Integer)
    user_id = Column(Integer, ForeignKey("users.id"))
    status = Column(String(20), default="pending")
    progress = Column(Integer, default=0)
    file_path = Column(String(500))
    created_at = Column(DateTime, server_default=func.now())

class Setting(Base):
    __tablename__ = "settings"
    key = Column(String(100), primary_key=True)
    value = Column(Text)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
