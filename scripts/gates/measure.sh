#!/usr/bin/env bash
# Compile the REAL game modules (economy, deals, draft engine, season sim) and
# run the balance measurement studies. No estimates — the actual code.
set -euo pipefail
cd "$(dirname "$0")/../.."

rm -rf .tmp-measure
npx tsc \
  src/lib/gates/warmup-economy.ts \
  src/lib/gates/warmup-deals.ts \
  src/lib/draft/types.ts \
  src/lib/draft/formations.ts \
  src/lib/draft/score.ts \
  src/lib/draft/match.ts \
  src/lib/draft/season.ts \
  src/lib/draft/pool.ts \
  src/data/draft/wc2026.ts \
  --rootDir src --outDir .tmp-measure \
  --module commonjs --moduleResolution node --target es2022 \
  --esModuleInterop --skipLibCheck --resolveJsonModule --types node >/dev/null 2>&1 || true

# The repo's "@/" alias doesn't exist at plain-node runtime: rewrite to relative
# paths (all compiled importers sit at depth 2) and colocate the data JSON.
mkdir -p .tmp-measure/data/draft
cp src/data/draft/player-seasons.json .tmp-measure/data/draft/
find .tmp-measure -name "*.js" -exec sed -i '' 's#"@/#"../../#g' {} +

node scripts/gates/measure.mjs
status=$?
rm -rf .tmp-measure
exit $status
