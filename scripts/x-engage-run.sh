#!/bin/bash
# x-engage-run.sh — find viral football tweets and push reply/quote drafts to Telegram.
# APPROVAL-GATED: only queues + pushes; nothing posts without a tap. Driven HOURLY through
# waking hours by ~/Library/LaunchAgents/app.yourscore.x-engage.plist. Per-run target is small
# (--n 2) because it runs often; the strict bar + per-target dedup keep it from flooding.
set -uo pipefail
REPO="/Users/zchukwumah/yourscore"
NODE="/usr/local/bin/node"
LOG="$REPO/scripts/data/x-engage.log"
cd "$REPO" || exit 1
echo "===== $(date '+%Y-%m-%d %H:%M %Z') =====" >> "$LOG"
"$NODE" --env-file=.env.local scripts/x-engage.mjs --n 2 >> "$LOG" 2>&1
