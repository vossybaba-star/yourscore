#!/usr/bin/env bash
# Build the fantasy player pool (src/data/fantasy/pool.json) with SportMonks ids
# BAKED IN at build time (scoring never fuzzy-matches names at runtime).
# Usage: bash scripts/fantasy/build-pool.sh          (replay: 25/26 prices ∩ SM 25583)
#        FANTASY_POOL_MODE=live bash …               (live: current bootstrap ∩ SM 28083)
set -euo pipefail
cd "$(dirname "$0")/../.."

if [ -z "${SPORTMONKS_API_KEY:-}" ] && [ -f .env.local ]; then
  export SPORTMONKS_API_KEY=$(grep '^SPORTMONKS_API_KEY=' .env.local | cut -d= -f2)
fi

rm -rf .tmp-fantasy-pool
npx tsc \
  src/lib/gates/types.ts \
  src/lib/gates/rng.ts \
  src/lib/gates/fpl.ts \
  src/lib/gates/sportmonks.ts \
  --rootDir src --outDir .tmp-fantasy-pool \
  --module commonjs --moduleResolution node --target es2022 \
  --esModuleInterop --skipLibCheck --types node

node scripts/fantasy/build-pool.mjs
status=$?
rm -rf .tmp-fantasy-pool
exit $status
