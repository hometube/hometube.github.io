#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "🚀 HomeTube Installer"
echo ""

# Ensure bun (the whole runtime: server + CLI are a single Bun binary/tree).
if ! command -v bun >/dev/null 2>&1; then
  echo "📦 bun not found — installing from bun.sh..."
  curl -fsSL https://bun.sh/install | bash >/dev/null
  export PATH="$HOME/.bun/bin:$PATH"
  if ! command -v bun >/dev/null 2>&1; then
    echo "❌ bun install failed. Install it manually: https://bun.sh" >&2
    exit 1
  fi
fi

# Optional external tools (downloads need these; ht install prints hints too).
command -v ffmpeg >/dev/null 2>&1 || echo "⚠️  ffmpeg not found — needed for music (brew install ffmpeg)"
command -v yt-dlp >/dev/null 2>&1 || echo "⚠️  yt-dlp not found — needed for downloads (brew install yt-dlp)"

echo "=== Server ==="
cd "$SCRIPT_DIR/server"
bun install

echo ""
echo "=== CLI ==="
bun src/cli.ts install

echo ""
echo "✅ HomeTube installation complete!"
echo ""
echo "To start the server:"
echo "  ht serve                   # http://localhost:8000 on your LAN"
echo ""
echo "Or use the ht CLI tool:"
echo "  ht init                    # configure data directory and user"
echo "  ht login <username>        # set active user"
echo "  ht download <url>          # download videos/music"
echo "  ht export -o backup.ht     # export your data"
