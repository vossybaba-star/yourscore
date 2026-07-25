#!/usr/bin/env bash
# Daily FPL-flip check (scheduled + manual). Detects the 2026/27 FPL launch,
# alerts Telegram, and auto-rebuilds the warm-up question pool.
# Usage: bash scripts/gates/check-fpl-flip.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

LOG=scripts/data/fpl-flip.cron.log
echo "── $(date '+%Y-%m-%d %H:%M:%S') check-fpl-flip" >> "$LOG"
node --env-file=.env.local scripts/gates/check-fpl-flip.mjs "$@" 2>&1 | tee -a "$LOG"
exit "${PIPESTATUS[0]}"
