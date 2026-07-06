#!/bin/bash
# reddit-poll-run.sh — process founder taps (Post/Edit/Skip) on Reddit draft cards.
# Driven by ~/Library/LaunchAgents/app.yourscore.reddit-poll.plist every 2 min.

set -uo pipefail
REPO="/Users/zchukwumah/yourscore"
NODE="/usr/local/bin/node"
LOG="$REPO/scripts/data/reddit-poll.log"

cd "$REPO" || exit 1
# Needs the dedicated review bot; quiet until then. (Reddit API creds are NOT
# required - in RSS mode taps just record manual posts.)
grep -q '^REDDIT_TELEGRAM_BOT_TOKEN=.' .env.local 2>/dev/null || exit 0
"$NODE" --env-file=.env.local scripts/reddit-telegram.mjs poll >> "$LOG" 2>&1
