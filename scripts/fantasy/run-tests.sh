#!/usr/bin/env bash
# Fantasy engine tests. Pure type-strippable TS with extensionless imports (repo
# convention); compile to CommonJS in a temp dir and run node --test on it —
# same approach as scripts/gates/run-tests.sh.
set -euo pipefail
cd "$(dirname "$0")/../.."

rm -rf .tmp-fantasy-test
npx tsc \
  src/lib/fantasy/values.ts \
  src/lib/fantasy/engine.ts \
  src/lib/fantasy/engine.test.ts \
  --rootDir src --outDir .tmp-fantasy-test \
  --module commonjs --moduleResolution node --target es2022 \
  --esModuleInterop --skipLibCheck --types node

node --test .tmp-fantasy-test/lib/fantasy/*.test.js
status=$?
rm -rf .tmp-fantasy-test
exit $status
