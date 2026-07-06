#!/bin/bash
# reengage-oneshot.sh — fire the 3 founder-approved dormant re-engagement broadcasts
# ONCE at 08:00, then self-destruct so it never repeats.
#
# Content + audience approved Jul 4 2026 (Versus / WC XI→Mastermind / Mastermind win-back),
# so no Telegram gate. Driven by ~/Library/LaunchAgents/app.yourscore.reengage-oneshot.plist
# (StartCalendarInterval 08:00, NO RunAtLoad → does not fire when loaded).
set -uo pipefail
REPO="/Users/zchukwumah/yourscore"
NODE="/usr/local/bin/node"
LOG="$REPO/scripts/data/reengage-oneshot.log"
GUARD="$REPO/scripts/data/reengage-oneshot.done"
LABEL="app.yourscore.reengage-oneshot"

cd "$REPO" || exit 1
echo "===== $(date '+%Y-%m-%d %H:%M %Z') fire =====" >> "$LOG"

if [ -f "$GUARD" ]; then
  echo "guard present — already sent, skipping" >> "$LOG"
else
  send() {  # $1 segment  $2 template  $3 subject  $4 preview
    echo "--- $1 $(date '+%H:%M:%S') ---" >> "$LOG"
    "$NODE" --env-file=.env.local scripts/segments.mjs send "$1" \
      --template "$2" --subject "$3" --preview-text "$4" --send >> "$LOG" 2>&1 \
      || echo "!! $1 send failed (exit $?)" >> "$LOG"
  }
  send "dormant-versus"       "emails/lifecycle/reengagement-versus.html" \
       "There's a new way to play: go head to head" \
       "Match a real opponent in seconds. We built it while you were away."
  send "wc-run-no-mastermind"  "emails/lifecycle/winback-wc-run-to-mastermind.html" \
       "You've only played half of the World Cup" \
       "You've built the squads. You've never played the ranked one."
  send "wc-mastermind-lapsed"  "emails/lifecycle/25-winback-first-wc.html" \
       "The World Cup Mastermind kept going" \
       "It's run every day since you joined. Today's is a good one."
  touch "$GUARD"
  echo "===== done $(date '+%H:%M %Z') =====" >> "$LOG"
fi

# Self-destruct: remove the plist first, then unload — so it can never fire again.
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
