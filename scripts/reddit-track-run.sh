#!/bin/bash
# reddit-track-run.sh — scan Reddit, draft replies, push new cards to Telegram.
# Driven by ~/Library/LaunchAgents/app.yourscore.reddit-track.plist.
# Listens + drafts only; posting happens exclusively on a Telegram tap.

set -uo pipefail
REPO="/Users/zchukwumah/yourscore"
NODE="/usr/local/bin/node"
LOG="$REPO/scripts/data/reddit-track.log"

cd "$REPO" || exit 1
# Reading works without Reddit creds (RSS fallback), but drafts are pointless
# until the review bot exists to card them — that token is the arm switch.
grep -q '^REDDIT_TELEGRAM_BOT_TOKEN=.' .env.local 2>/dev/null || exit 0
echo "===== $(date '+%Y-%m-%d %H:%M %Z') =====" >> "$LOG"
"$NODE" --env-file=.env.local scripts/reddit-track.mjs >> "$LOG" 2>&1
"$NODE" --env-file=.env.local scripts/reddit-telegram.mjs push >> "$LOG" 2>&1
