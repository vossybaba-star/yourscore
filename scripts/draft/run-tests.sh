#!/usr/bin/env bash
# Draft XI scoring tests. The scoring engine is pure TS with extensionless
# imports (repo convention); Node's ESM loader can't resolve those at runtime,
# so we compile the module to CommonJS in a temp dir and run node --test on it.
set -euo pipefail
cd "$(dirname "$0")/../.."

rm -rf .tmp-draft-test
npx tsc \
  src/lib/draft/types.ts \
  src/lib/draft/formations.ts \
  src/lib/draft/score.ts \
  src/lib/draft/score.test.ts \
  src/lib/draft/match.ts \
  src/lib/draft/match.test.ts \
  src/lib/draft/season.ts \
  src/lib/draft/season.test.ts \
  src/lib/draft/live-score.ts \
  src/lib/draft/live-score.test.ts \
  --outDir .tmp-draft-test \
  --module commonjs --moduleResolution node --target es2022 \
  --esModuleInterop --skipLibCheck --types node >/dev/null 2>&1 || true

node --test .tmp-draft-test/score.test.js .tmp-draft-test/match.test.js .tmp-draft-test/season.test.js .tmp-draft-test/live-score.test.js
status=$?
rm -rf .tmp-draft-test
exit $status
