#!/bin/bash
# x-drip-run.sh — release valve. Posts ONE approved draft, then exits.
#
# Driven by ~/Library/LaunchAgents/app.yourscore.x-drip.plist on a ~40-min grid
# through the evening, so approved tweets trickle out one at a time (never a burst)
# and the account reads as live in the conversation. It only ever posts drafts you
# have already APPROVED; if none are approved, it does nothing.

set -uo pipefail
REPO="/Users/zchukwumah/yourscore"
NODE="/usr/local/bin/node"
LOG="$REPO/scripts/data/x-drip.log"

cd "$REPO" || exit 1
echo "===== $(date '+%Y-%m-%d %H:%M %Z') =====" >> "$LOG"
"$NODE" --env-file=.env.local scripts/x-queue.mjs post --next >> "$LOG" 2>&1
