#!/bin/bash
# launch-daily.sh — fires the gated daily WC quiz launch (pure node, Telegram-gated).
#
# Driven by ~/Library/LaunchAgents/app.yourscore.quiz-launch.plist at ~07:06 local, AFTER
# the 06:42 Claude draft routine (yourscore-daily-worldcup-quiz) has written today's JSON.
#
# launch-daily.mjs publishes the pack, then (on Telegram approval) rolls the WC Mastermind
# edition, generates + attaches the two cards, posts the tweet and sends the email — each
# behind its own approval gate. It halts safely if there is no fresh quiz dated today.
#
# Pure OS-level scheduling, so it runs without the Claude app open. The 08:00 wc-roll.sh
# stays as an idempotent backstop for the edition roll.

set -uo pipefail
REPO="/Users/zchukwumah/yourscore"
NODE="/usr/local/bin/node"
LOG="$REPO/scripts/data/launch-daily.cron.log"

cd "$REPO" || exit 1
echo "===== $(date '+%Y-%m-%d %H:%M %Z') =====" >> "$LOG"
"$NODE" --env-file=.env.local scripts/launch-daily.mjs >> "$LOG" 2>&1
echo "----- exit $? -----" >> "$LOG"
