import asyncio
from datetime import datetime, timedelta
from database import SessionLocal
from models import Subscription, Video, Music, Channel
from .ytdlp import get_channel_videos, pick_album_art

async def check_subscriptions():
    while True:
        db = SessionLocal()
        try:
            subs = db.query(Subscription).all()
            for sub in subs:
                if sub.last_checked and (datetime.utcnow() - sub.last_checked).seconds < sub.check_interval:
                    continue
                channel = db.query(Channel).filter(Channel.id == sub.channel_id).first()
                if not channel:
                    continue
                is_podcast = (sub.kind or "video") == "podcast"
                videos = get_channel_videos(channel.url)
                for v in videos:
                    v_id = v.get("id")
                    if not v_id:
                        continue
                    if is_podcast:
                        exists = db.query(Music).filter(Music.kind == "podcast", Music.video_id == v_id).first()
                    else:
                        exists = db.query(Video).filter(Video.video_id == v_id).first()
                    if not exists:
                        criteria = sub.criteria or {}
                        title = v.get("title", "")
                        if criteria.get("keywords"):
                            if not any(k.lower() in title.lower() for k in criteria["keywords"]):
                                continue
                        duration = v.get("duration", 0)
                        if criteria.get("min_length") and duration < criteria["min_length"]:
                            continue
                        if criteria.get("max_length") and duration > criteria["max_length"]:
                            continue
                        if is_podcast:
                            ep_url = v.get("webpage_url") or v.get("url") or f"https://www.youtube.com/watch?v={v_id}"
                            ep = Music(
                                video_id=v_id,
                                title=title,
                                channel_id=channel.id,
                                url=ep_url,
                                artist=channel.name,
                                album_art=pick_album_art(v),
                                is_playlist=False,
                                downloaded=False,
                                added_by=sub.user_id,
                                kind="podcast"
                            )
                            db.add(ep)
                        else:
                            vid = Video(
                                video_id=v_id,
                                title=title,
                                channel_id=channel.id,
                                url=v.get("url"),
                                added_by=sub.user_id,
                                quality=criteria.get("quality", "best")
                            )
                            db.add(vid)
                sub.last_checked = datetime.utcnow()
                db.commit()
            # Auto-delete watched videos older than 7 days without keep flag
            cutoff = datetime.utcnow() - timedelta(days=7)
            old_videos = db.query(Video).filter(
                Video.watched_at != None,
                Video.watched_at < cutoff,
                Video.keep_flag == False
            ).all()
            for vid in old_videos:
                import os
                from paths import downloads_dir
                vid_path = os.path.join(downloads_dir(), "videos", f"{vid.video_id}.mp4")
                if os.path.exists(vid_path):
                    os.remove(vid_path)
                db.delete(vid)
            db.commit()
        finally:
            db.close()
        await asyncio.sleep(60)
