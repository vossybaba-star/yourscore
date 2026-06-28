#!/bin/bash
# x-ideas-run.sh — one scheduled run of the tweet IDEAS agent.
# Driven by ~/Library/LaunchAgents/app.yourscore.x-ideas.plist every 3h, waking
# hours BST: 08:00, 11:00, 14:00, 17:00, 20:00, 23:00.
# Proposes 3-4 fresh original ideas and pushes them to Telegram (with buttons).
# x-ideas.mjs does the push itself; the x-telegram poller handles your taps.
# Nothing posts without a tap.
set -uo pipefail
cd /Users/zchukwumah/yourscore || exit 1
NODE=/usr/local/bin/node
LOG="scripts/data/x-ideas.log"
echo "===== $(date '+%Y-%m-%d %H:%M %Z') =====" >> "$LOG"
"$NODE" --env-file=.env.local scripts/x-ideas.mjs >> "$LOG" 2>&1
echo "  -> exit $?" >> "$LOG"
