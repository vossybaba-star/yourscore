#!/usr/bin/env bash
# Compile the gate modules and run the live-FPL validation (network).
set -euo pipefail
cd "$(dirname "$0")/../.."

rm -rf .tmp-gates-val
npx tsc \
  src/lib/gates/types.ts \
  src/lib/gates/rng.ts \
  src/lib/gates/fame.ts \
  src/lib/gates/higher-lower.ts \
  src/lib/gates/fpl.ts \
  src/lib/gates/sportmonks.ts \
  src/lib/gates/who-am-i.ts \
  --rootDir src --outDir .tmp-gates-val \
  --module commonjs --moduleResolution node --target es2022 \
  --esModuleInterop --skipLibCheck --types node

node scripts/gates/validate.mjs
status=$?
rm -rf .tmp-gates-val
exit $status
