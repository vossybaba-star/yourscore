#!/usr/bin/env bash
# Gate generator tests. Pure type-strippable TS with extensionless imports (repo
# convention); Node's ESM loader can't resolve those, so compile to CommonJS in a
# temp dir and run node --test on it — same approach as scripts/draft/run-tests.sh.
set -euo pipefail
cd "$(dirname "$0")/../.."

rm -rf .tmp-gates-test
npx tsc \
  src/lib/gates/types.ts \
  src/lib/gates/rng.ts \
  src/lib/gates/fame.ts \
  src/lib/gates/higher-lower.ts \
  src/lib/gates/fpl.ts \
  src/lib/gates/sportmonks.ts \
  src/lib/gates/who-am-i.ts \
  src/lib/gates/serve.ts \
  src/lib/gates/history.ts \
  src/lib/gates/trivia.ts \
  src/lib/gates/career-path.ts \
  src/lib/gates/gates.test.ts \
  src/lib/gates/enrich.test.ts \
  src/lib/gates/serve.test.ts \
  src/lib/gates/history.test.ts \
  --rootDir src --outDir .tmp-gates-test \
  --module commonjs --moduleResolution node --target es2022 \
  --esModuleInterop --skipLibCheck --types node

node --test .tmp-gates-test/lib/gates/*.test.js
status=$?
rm -rf .tmp-gates-test
exit $status
