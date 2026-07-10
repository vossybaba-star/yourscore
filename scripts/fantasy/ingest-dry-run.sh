#!/usr/bin/env bash
# Ingest dry-run: run the PRODUCTION ingest path (src/lib/fantasy/ingest.ts,
# smId identity — no name matching) over the cached GW30 fixtures and check the
# result against FPL actual. Pass bars: coverage ≥ 80%, Spearman ≥ 0.95.
set -euo pipefail
cd "$(dirname "$0")/../.."

rm -rf .tmp-fantasy-ing
npx tsc src/lib/fantasy/values.ts src/lib/fantasy/ingest.ts \
  --rootDir src --outDir .tmp-fantasy-ing \
  --module commonjs --moduleResolution node --target es2022 \
  --esModuleInterop --skipLibCheck --types node

node scripts/fantasy/ingest-dry-run.mjs "${1:-30}"
status=$?
rm -rf .tmp-fantasy-ing
exit $status
