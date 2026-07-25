#!/usr/bin/env bash
# Compile the gate modules and build src/data/gates/pool.json from live data.
# Usage: SPORTMONKS_API_KEY=… bash scripts/gates/build-pool.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

if [ -z "${SPORTMONKS_API_KEY:-}" ] && [ -f .env.local ]; then
  export SPORTMONKS_API_KEY=$(grep '^SPORTMONKS_API_KEY=' .env.local | cut -d= -f2)
fi

rm -rf .tmp-gates-val
npx tsc \
  src/lib/gates/types.ts \
  src/lib/gates/rng.ts \
  src/lib/gates/fame.ts \
  src/lib/gates/higher-lower.ts \
  src/lib/gates/fpl.ts \
  src/lib/gates/sportmonks.ts \
  src/lib/gates/who-am-i.ts \
  src/lib/gates/history.ts \
  src/lib/gates/trivia.ts \
  src/lib/gates/career-path.ts \
  --rootDir src --outDir .tmp-gates-val \
  --module commonjs --moduleResolution node --target es2022 \
  --esModuleInterop --skipLibCheck --types node

node scripts/gates/build-pool.mjs
status=$?
rm -rf .tmp-gates-val
exit $status
