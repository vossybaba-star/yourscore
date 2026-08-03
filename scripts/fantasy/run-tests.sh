#!/usr/bin/env bash
# Fantasy engine tests. Pure type-strippable TS with extensionless imports (repo
# convention); compile to CommonJS in a temp dir and run node --test on it —
# same approach as scripts/gates/run-tests.sh.
#
# Not using `set -e`: two independent test blocks run below (the general engine
# block, then squadRating's own block — see why below) and both must always run
# and always clean up their temp output, even if one fails; `overall` tracks the
# combined exit code instead.
set -uo pipefail
cd "$(dirname "$0")/../.."

overall=0

rm -rf .tmp-fantasy-test
npx tsc \
  src/lib/fantasy/values.ts \
  src/lib/fantasy/engine.ts \
  src/lib/fantasy/engine.test.ts \
  src/lib/fantasy/ingest.ts \
  src/lib/fantasy/ingest.test.ts \
  src/lib/fantasy/board.ts \
  src/lib/fantasy/board.test.ts \
  src/lib/fantasy/presets.ts \
  src/lib/fantasy/presets.test.ts \
  src/lib/fantasy/liveEvents.ts \
  src/lib/fantasy/liveEvents.test.ts \
  src/lib/fantasy/months.ts \
  src/lib/fantasy/months.test.ts \
  src/lib/fantasy/clubKey.ts \
  src/lib/fantasy/context.test.ts \
  src/lib/fantasy/ops-diff.ts \
  src/lib/fantasy/ops.test.ts \
  --rootDir src --outDir .tmp-fantasy-test \
  --module commonjs --moduleResolution node --target es2022 \
  --esModuleInterop --skipLibCheck --types node
[ $? -eq 0 ] || overall=1

node --test .tmp-fantasy-test/lib/fantasy/*.test.js
[ $? -eq 0 ] || overall=1
rm -rf .tmp-fantasy-test

# ── squadRating: its own block, not folded into the one above ───────────────
# squadRating.ts's impure orchestrator reaches ./pool and ./context, which
# import `@/data/fantasy/*.json` and other `@/*`-aliased modules. The block
# above only ever compiles files that stick to relative imports, so a bare
# `tsc <files> --module commonjs ...` (no project file) never has to resolve
# `@/*` or a `.json` import. squadRating.ts can't make that same trade, so it
# compiles via a REAL tsconfig — extending the repo's own (paths +
# resolveJsonModule already live there) with only module/target/outDir
# overridden — and, since tsc never rewrites `@/*` at emit time (that's a
# type-check-only hint), it runs via `tsconfig-paths/register` so the compiled
# JS's `require("@/...")` calls resolve too. `--test-force-exit` matters here
# specifically: src/lib/ratelimit.ts (pulled in via ./pool -> ... -> the
# distributed rate limiter) has a module-scope `setInterval` that would
# otherwise keep node --test's process alive forever after the last test.
rm -rf .tmp-squadrating-test
cat > .tmp-squadrating-tsconfig.json <<'EOF'
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "commonjs",
    "moduleResolution": "node",
    "target": "es2022",
    "noEmit": false,
    "isolatedModules": false,
    "incremental": false,
    "outDir": ".tmp-squadrating-test",
    "rootDir": "src"
  },
  "files": [
    "src/lib/fantasy/squadRating.ts",
    "src/lib/fantasy/squadRating.test.ts"
  ],
  "include": []
}
EOF
cat > .tmp-squadrating-runtime-tsconfig.json <<'EOF'
{
  "compilerOptions": {
    "baseUrl": ".tmp-squadrating-test",
    "paths": { "@/*": ["./*"] }
  }
}
EOF

npx tsc -p .tmp-squadrating-tsconfig.json
[ $? -eq 0 ] || overall=1

TS_NODE_PROJECT=.tmp-squadrating-runtime-tsconfig.json \
  node -r tsconfig-paths/register --conditions=react-server --test --test-force-exit \
  .tmp-squadrating-test/lib/fantasy/squadRating.test.js
[ $? -eq 0 ] || overall=1

rm -rf .tmp-squadrating-test .tmp-squadrating-tsconfig.json .tmp-squadrating-runtime-tsconfig.json

exit $overall
