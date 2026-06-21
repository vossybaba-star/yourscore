#!/bin/bash
# roll-wc-edition.sh — daily safety roll for the World Cup Mastermind edition.
#
# Driven by ~/Library/LaunchAgents/app.yourscore.wc-roll.plist once each morning.
# Rolls the ranked edition to TODAY (UTC) so the daily never freezes again — which is
# exactly what happened 19-21 Jun: the roll is otherwise only a manual step inside the
# daily quiz launch, and when the launch didn't run for three days the edition stuck on
# 18 Jun. roll-wc-edition.mjs targets today's UTC date, so a late/missed fire still does
# the right thing on the next run, and re-rolling the same date is a harmless no-op — the
# manual launch (images/tweet/email) can still run later and just re-rolls the same day.

set -uo pipefail
REPO="/Users/zchukwumah/yourscore"
NODE="/usr/local/bin/node"
LOG="$REPO/scripts/data/wc-roll.cron.log"

cd "$REPO" || exit 1
echo "===== $(date '+%Y-%m-%d %H:%M %Z') =====" >> "$LOG"
"$NODE" scripts/draft/roll-wc-edition.mjs >> "$LOG" 2>&1
