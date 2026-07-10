#!/usr/bin/env bash
# Scoring-values acceptance test: compile src/lib/fantasy/values.ts and check the
# ranking it produces on a real gameweek against FPL actual (Spearman ≥ 0.98).
# Usage: bash scripts/fantasy/familiarity.sh [gw]
set -euo pipefail
cd "$(dirname "$0")/../.."

rm -rf .tmp-fantasy-val
npx tsc src/lib/fantasy/values.ts \
  --rootDir src --outDir .tmp-fantasy-val \
  --module commonjs --moduleResolution node --target es2022 \
  --esModuleInterop --skipLibCheck --types node

node scripts/fantasy/familiarity.mjs "${1:-30}"
status=$?
rm -rf .tmp-fantasy-val
exit $status
