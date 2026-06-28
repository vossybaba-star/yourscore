#!/bin/bash
# x-evening-run.sh — the scheduled "appear live" pull for the World Cup.
#
# Runs x-track to refresh the repurpose queue with fresh football reactions, then
# pops a macOS notification if anything new landed. APPROVAL-GATED: this only ever
# QUEUES drafts. It never posts. You still approve + post with x-queue.mjs.
#
# Driven by the launchd job ~/Library/LaunchAgents/app.yourscore.x-track.plist
# (evenings, BST). Run it by hand any time to fill the queue now:
#   bash scripts/x-evening-run.sh

set -uo pipefail
REPO="/Users/zchukwumah/yourscore"
NODE="/usr/local/bin/node"
LOG="$REPO/scripts/data/x-track.log"

cd "$REPO" || exit 1
TS="$(date '+%Y-%m-%d %H:%M %Z')"
echo "===== $TS =====" >> "$LOG"

OUT="$("$NODE" --env-file=.env.local scripts/x-track.mjs 2>&1)"
echo "$OUT" >> "$LOG"

# Push the new drafts to Telegram for review (Post / Add GIF / Skip).
"$NODE" --env-file=.env.local scripts/x-telegram.mjs push >> "$LOG" 2>&1

# Pull "queued N new" from the summary line for a desktop nudge.
NEW="$(printf '%s\n' "$OUT" | sed -n 's/.*queued \([0-9][0-9]*\) new.*/\1/p' | tail -1)"
if [ -n "${NEW:-}" ] && [ "$NEW" -gt 0 ] 2>/dev/null; then
  osascript -e "display notification \"$NEW new football draft(s) ready to review\" with title \"YourScore X queue\" sound name \"Glass\"" >/dev/null 2>&1 || true
fi

# Echo the tail so a manual run / the cron log shows the result.
printf '%s\n' "$OUT" | tail -3
