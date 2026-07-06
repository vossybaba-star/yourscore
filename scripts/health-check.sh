#!/bin/bash
# health-check.sh — synthetic health check + gamer QA, 4x/day.
#
# Driven by ~/Library/LaunchAgents/app.yourscore.health.plist at 08:20, 12:30,
# 17:45, 22:30 UK. Probes prod (yourscore.app), plays the games as the health
# bot, smoke-tests the app in a headless browser, and Telegrams a scorecard
# after every run. Safe to fire manually anytime:
#   bash scripts/health-check.sh
#
# VPS migration: replace the plist with 4 crontab lines running this same file.

set -uo pipefail
REPO="/Users/zchukwumah/yourscore"
NODE="/usr/local/bin/node"
LOG="$REPO/scripts/data/health.cron.log"

cd "$REPO" || exit 1
echo "===== $(date '+%Y-%m-%d %H:%M %Z') =====" >> "$LOG"
"$NODE" --env-file=.env.local scripts/health/check.mjs "$@" >> "$LOG" 2>&1
echo "----- exit $? -----" >> "$LOG"
