#!/usr/bin/env python3
"""
Utility to import existing music files into HomeTube.
Scans a folder of music files, extracts metadata, and creates Music records.
"""

import os
import sys
import re
import argparse
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import models
import mutagen
from mutagen.easyid3 import EasyID3
from mutagen.mp3 import MP3
from mutagen.flac import FLAC
from mutagen.wave import WAVE

from paths import db_path, downloads_dir

DB_PATH = db_path()
engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

DL_DIR = downloads_dir()
MUSIC_DIR = os.path.join(DL_DIR, "music")

SUPPORTED_EXTENSIONS = {'.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg', '.webm'}

def extract_metadata(filepath):
    """Extract metadata from audio file."""
    ext = Path(filepath).suffix.lower()
    filename = Path(filepath).stem
    metadata = {
        'title': filename,
        'artist': 'Unknown Artist',
        'album': None,
        'video_id': None,
    }

    # Try to extract video_id from filename (format: "Artist - Title [video_id]")
    video_id_match = re.search(r'\[([^\]]+)\]$', filename)
    if video_id_match:
        metadata['video_id'] = video_id_match.group(1)
        # Clean title by removing video_id
        metadata['title'] = re.sub(r'\s*\[([^\]]+)\]\s*$', '', filename)

    try:
        if ext == '.mp3':
            audio = MP3(filepath)
            try:
                id3 = EasyID3(filepath)
                metadata['title'] = id3.get('title', [metadata['title']])[0]
                metadata['artist'] = id3.get('artist', [metadata['artist']])[0]
                metadata['album'] = id3.get('album', [None])[0]
            except:
                if 'TIT2' in audio:
                    metadata['title'] = str(audio['TIT2'])
                if 'TPE1' in audio:
                    metadata['artist'] = str(audio['TPE1'])
                if 'TALB' in audio:
                    metadata['album'] = str(audio['TALB'])
        elif ext == '.flac':
            audio = FLAC(filepath)
            metadata['title'] = audio.get('title', [metadata['title']])[0]
            metadata['artist'] = audio.get('artist', [metadata['artist']])[0]
            metadata['album'] = audio.get('album', [None])[0]
        elif ext == '.wav':
            audio = WAVE(filepath)
            if audio.tags:
                metadata['title'] = audio.tags.get('title', [metadata['title']])[0]
                metadata['artist'] = audio.tags.get('artist', [metadata['artist']])[0]
        elif ext in ('.webm', '.m4a', '.ogg', '.aac'):
            audio = mutagen.File(filepath)
            if audio:
                # mutagen.File returns different tag formats for different file types
                if hasattr(audio, 'tags') and audio.tags:
                    metadata['title'] = audio.tags.get('title', [metadata['title']])[0] if audio.tags.get('title') else metadata['title']
                    metadata['artist'] = audio.tags.get('artist', [metadata['artist']])[0] if audio.tags.get('artist') else metadata['artist']
                    metadata['album'] = audio.tags.get('album', [None])[0] if audio.tags.get('album') else None
                # Also try direct attribute access for some formats
                if metadata['title'] == filename or metadata['title'] == metadata['title']:
                    for key in audio.keys():
                        if 'title' in key.lower() and audio[key]:
                            metadata['title'] = str(audio[key][0]) if isinstance(audio[key], list) else str(audio[key])
                            break
                    for key in audio.keys():
                        if 'artist' in key.lower() and audio[key]:
                            metadata['artist'] = str(audio[key][0]) if isinstance(audio[key], list) else str(audio[key])
                            break
    except Exception as e:
        print(f"  Warning: Could not extract metadata from {filepath}: {e}")

    return metadata

def import_music_folder(folder_path, user_id, playlist_id=None, copy_files=True):
    """Import all music files from a folder."""
    folder = Path(folder_path)
    if not folder.exists():
        print(f"Error: Folder {folder_path} does not exist")
        return

    os.makedirs(MUSIC_DIR, exist_ok=True)

    db = SessionLocal()
    try:
        # Verify user exists
        user = db.query(models.User).filter(models.User.id == user_id).first()
        if not user:
            print(f"Error: User with ID {user_id} not found")
            return

        # Verify playlist if specified
        if playlist_id:
            playlist = db.query(models.Playlist).filter(models.Playlist.id == playlist_id).first()
            if not playlist:
                print(f"Error: Playlist with ID {playlist_id} not found")
                return
            if playlist.user_id != user_id:
                print(f"Warning: Playlist belongs to different user")

        # Get existing files in music dir to avoid conflicts
        existing_files = set(os.listdir(MUSIC_DIR))

        imported = 0
        skipped = 0

        for filepath in folder.rglob('*'):
            if filepath.is_file() and filepath.suffix.lower() in SUPPORTED_EXTENSIONS:
                print(f"Processing: {filepath.name}")

                # Extract metadata
                metadata = extract_metadata(filepath)

                # Generate unique filename
                ext = filepath.suffix.lower()
                base_name = f"{metadata['artist']} - {metadata['title']}".replace('/', '-').replace('\\', '-')
                dest_filename = f"{base_name}{ext}"

                # Ensure unique filename
                counter = 0
                original_dest = dest_filename
                while dest_filename in existing_files:
                    counter += 1
                    dest_filename = f"{Path(original_dest).stem} ({counter}){ext}"
                existing_files.add(dest_filename)

                # Copy or move file
                dest_path = os.path.join(MUSIC_DIR, dest_filename)
                if copy_files:
                    import shutil
                    shutil.copy2(filepath, dest_path)
                else:
                    import shutil
                    shutil.move(filepath, dest_path)

                # Create Music record
                music = models.Music(
                    url=f"file://{dest_filename}",
                    title=metadata['title'],
                    artist=metadata['artist'],
                    video_id=metadata['video_id'],
                    filename=dest_filename,
                    album_art=None,
                    is_playlist=False,
                    downloaded=True,
                    added_by=user_id,
                )
                db.add(music)
                db.flush()  # Get the ID

                # Add to playlist if specified
                if playlist_id:
                    songs = playlist.songs or []
                    songs.append({"music_id": music.id, "position": len(songs)})
                    playlist.songs = songs

                imported += 1
                print(f"  Imported: {metadata['title']} by {metadata['artist']}")

        db.commit()
        print(f"\nImport complete: {imported} files imported, {skipped} skipped")

    except Exception as e:
        db.rollback()
        print(f"Error: {e}")
        raise
    finally:
        db.close()

def list_users():
    """List all users."""
    db = SessionLocal()
    try:
        users = db.query(models.User).all()
        print("Users:")
        for user in users:
            print(f"  ID: {user.id}, Username: {user.username}")
    finally:
        db.close()

def list_playlists(user_id=None):
    """List all playlists."""
    db = SessionLocal()
    try:
        query = db.query(models.Playlist)
        if user_id:
            query = query.filter(models.Playlist.user_id == user_id)
        playlists = query.all()
        print("Playlists:")
        for playlist in playlists:
            print(f"  ID: {playlist.id}, Name: {playlist.name}, User ID: {playlist.user_id}")
    finally:
        db.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Import music files into HomeTube")
    parser.add_argument("--folder", "-f", help="Folder containing music files to import")
    parser.add_argument("--user-id", "-u", type=int, help="User ID to associate with imported music")
    parser.add_argument("--playlist-id", "-p", type=int, help="Playlist ID to add music to")
    parser.add_argument("--move", action="store_true", help="Move files instead of copying")
    parser.add_argument("--list-users", action="store_true", help="List all users")
    parser.add_argument("--list-playlists", action="store_true", help="List all playlists")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be imported without actually importing")

    args = parser.parse_args()

    if args.list_users:
        list_users()
        sys.exit(0)

    if args.list_playlists:
        list_playlists(args.user_id)
        sys.exit(0)

    if not args.folder or not args.user_id:
        parser.print_help()
        print("\nExamples:")
        print("  List users: python import_music.py --list-users")
        print("  List playlists: python import_music.py --list-playlists --user-id 1")
        print("  Import music: python import_music.py --folder /path/to/music --user-id 1")
        print("  Import to playlist: python import_music.py --folder /path/to/music --user-id 1 --playlist-id 1")
        sys.exit(1)

    import_music_folder(args.folder, args.user_id, args.playlist_id, copy_files=not args.move)
