#!/bin/bash
# x-propose-run.sh — one scheduled scan: propose ONE tweet, push ONLY that one.
# Driven by ~/Library/LaunchAgents/app.yourscore.x-propose.plist on two blocks:
#   morning   08:00, 08:30, 09:00, 09:30, 10:00  (catch overnight stories)
#   afternoon 15:00, 16:30, 18:00, 19:30, 21:00  (live during the games)
# Proposes only - nothing posts without a tap in Telegram.
set -uo pipefail
cd /Users/zchukwumah/yourscore || exit 1
NODE=/usr/local/bin/node
LOG="scripts/data/x-propose.log"
echo "===== $(date '+%Y-%m-%d %H:%M %Z') =====" >> "$LOG"

OUT="$("$NODE" --env-file=.env.local scripts/x-propose.mjs 2>&1)"
echo "$OUT" >> "$LOG"

# Push ONLY the draft just proposed (by id) - never "all pending", so a backlog
# can never cause a burst.
ID="$(printf '%s\n' "$OUT" | sed -n 's/^proposed \([A-Za-z0-9][A-Za-z0-9]*\) .*/\1/p' | head -1)"
if [ -n "$ID" ]; then
  "$NODE" --env-file=.env.local scripts/x-telegram.mjs push "$ID" >> "$LOG" 2>&1
  echo "  -> pushed single draft $ID" >> "$LOG"
else
  echo "  -> nothing proposed this run" >> "$LOG"
fi
