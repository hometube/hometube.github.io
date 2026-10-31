# -*- mode: python ; coding: utf-8 -*-
# PyInstaller build for the HomeTube backend server (desktop sidecar).
#
#   pyinstaller hometube-server.spec
#
# Produces dist/hometube-server/ (onedir): a folder with the launcher binary
# and _internal/. onedir is deliberate -- onefile re-extracts every launch,
# which is slow and noisy for a long-lived server. The desktop shell points
# HOMETUBE_SERVER at dist/hometube-server/hometube-server.
#
# uvicorn and yt_dlp both import submodules dynamically (uvicorn's loop/
# protocol/lifespan backends; yt_dlp's per-site extractors), so they are
# collected wholesale.

from PyInstaller.utils.hooks import collect_all

datas, binaries, hiddenimports = [], [], []
for pkg in ("uvicorn", "yt_dlp", "sqlalchemy", "mutagen", "qrcode"):
    d, b, h = collect_all(pkg)
    datas += d
    binaries += b
    hiddenimports += h

hiddenimports += [
    # uvicorn backend auto-selection.
    "uvicorn.logging",
    "uvicorn.loops.auto",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan.on",
    # Request body / auth / optional media deps resolved at runtime.
    "multipart",
    "jwt",
    "aiosqlite",
]

a = Analysis(
    ["main.py"],
    pathex=["."],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "PyQt5", "PySide2", "matplotlib"],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="hometube-server",
    debug=False,
    strip=False,
    upx=False,
    # Server sidecar: keep stdout/stderr attached so the desktop shell can
    # tail its logs through a pipe.
    console=True,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="hometube-server",
)
