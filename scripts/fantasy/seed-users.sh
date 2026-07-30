#!/usr/bin/env bash
# Compile the seed script (+ the pure engine/presets it uses) to CommonJS in a
# temp dir, then run it against prod with the service role. Same tsc→node dance
# as run-tests.sh. Args pass straight through: --dry, --count N.
set -euo pipefail
cd "$(dirname "$0")/../.."

rm -rf .tmp-seed
npx tsc \
  scripts/fantasy/seed-users.ts \
  src/lib/fantasy/values.ts \
  src/lib/fantasy/engine.ts \
  src/lib/fantasy/presets.ts \
  --outDir .tmp-seed --module commonjs --target es2020 \
  --moduleResolution node --esModuleInterop --skipLibCheck --resolveJsonModule --strict false

node --env-file=.env.local .tmp-seed/scripts/fantasy/seed-users.js "$@"
