#!/bin/bash
# x-telegram-poll.sh — process Telegram taps + GIF replies, then exit.
# Driven every ~60s by ~/Library/LaunchAgents/app.yourscore.x-telegram-poll.plist
# so Post/Add GIF/Skip on your phone act within a minute. Posts only on your tap.
set -uo pipefail
cd /Users/zchukwumah/yourscore || exit 1
/usr/local/bin/node --env-file=.env.local scripts/x-telegram.mjs poll >> scripts/data/x-telegram.log 2>&1
