#!/usr/bin/env bash
# Daily-nudge copy-engine tests. Same shape as scripts/draft/run-tests.sh: the
# module is pure TS with extensionless imports (repo convention), which Node's
# ESM loader can't resolve at runtime, so compile to CommonJS in a temp dir and
# run node --test on that.
set -euo pipefail
cd "$(dirname "$0")/../.."

rm -rf .tmp-notify-test
npx tsc \
  src/lib/notify/daily-nudge.ts \
  src/lib/notify/daily-nudge.test.ts \
  --rootDir src --outDir .tmp-notify-test \
  --module commonjs --moduleResolution node --target es2022 \
  --esModuleInterop --skipLibCheck --types node >/dev/null 2>&1 || true

node --test .tmp-notify-test/lib/notify/*.test.js
status=$?
rm -rf .tmp-notify-test
exit $status
