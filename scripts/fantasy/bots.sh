#!/usr/bin/env bash
# Compile the bot script (+ the pure modules it uses) to CommonJS in a temp dir,
# then run it against prod with the service role. Same tsc→node dance as
# seed-users.sh. Args pass straight through: --dry, --backfill N, --with-quiz,
# --seed-handles, --teardown.
set -euo pipefail
cd "$(dirname "$0")/../.."

rm -rf .tmp-bots
npx tsc \
  scripts/fantasy/bots.ts \
  src/lib/fantasy/values.ts \
  src/lib/fantasy/engine.ts \
  src/lib/fantasy/presets.ts \
  src/lib/fantasy/botContent.ts \
  --outDir .tmp-bots --module commonjs --target es2020 \
  --moduleResolution node --esModuleInterop --skipLibCheck --resolveJsonModule --strict false

node --env-file=.env.local .tmp-bots/scripts/fantasy/bots.js "$@"
