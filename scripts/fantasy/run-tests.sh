#!/usr/bin/env bash
# Fantasy engine tests. Pure type-strippable TS with extensionless imports (repo
# convention); compile to CommonJS in a temp dir and run node --test on it —
# same approach as scripts/gates/run-tests.sh.
#
# Two separate compile+run passes:
#
# There is deliberately NO projection.ts pass. The xP model it tested was
# measured against a most-owned template and lost (1757 template vs 1457 for the
# ML arm), so it was not ported off the abandoned branch. Do not re-add it here.
#
# 1. engine/months/advice/ppg — plain `node --test`. advice.ts only takes
#    `import type` from news.ts (never a value import — news.ts/pool.ts start
#    with `import "server-only"`, which throws under plain node), so nothing in
#    this graph actually requires "server-only" at runtime. It DOES need
#    `resolveJsonModule` + the "@/*" path alias, though: advice.ts's type-only
#    `import type {...} from "./news"` still makes tsc load news.ts for type
#    info, and news.ts value-imports pool.ts, which imports
#    "@/data/fantasy/pool.json" — a bare CLI file list can't express a path
#    alias (that's tsconfig-only), so this pass uses a generated tsconfig.
#
# 2. tips.ts/news.ts — tips.ts imports "server-only" directly and DOES need it
#    at runtime, so this pass runs under `node --conditions=react-server`
#    (verified live during build prep: `node -e "require('server-only')"`
#    throws; `node --conditions=react-server -e "require('server-only')"`
#    does not — Node resolves the package's "react-server" export condition to
#    its no-op file instead of the throwing default). Same path-alias/
#    resolveJsonModule need as pass 1, for the same reason (news.ts -> pool.ts).
set -euo pipefail
cd "$(dirname "$0")/../.."

cleanup() { rm -rf .tmp-fantasy-test .tmp-fantasy-test-tips .tmp-fantasy-tsconfig.json .tmp-fantasy-tsconfig-tips.json; }
trap cleanup EXIT
cleanup

cat > .tmp-fantasy-tsconfig.json <<'EOF'
{
  "compilerOptions": {
    "rootDir": "src", "outDir": ".tmp-fantasy-test",
    "module": "commonjs", "moduleResolution": "node", "target": "es2022",
    "esModuleInterop": true, "skipLibCheck": true, "types": ["node"],
    "resolveJsonModule": true, "baseUrl": ".", "paths": { "@/*": ["src/*"] }
  },
  "include": [
    "src/lib/fantasy/values.ts", "src/lib/fantasy/engine.ts", "src/lib/fantasy/engine.test.ts",
    "src/lib/fantasy/months.ts", "src/lib/fantasy/months.test.ts",
    "src/lib/fantasy/advice.ts", "src/lib/fantasy/advice.test.ts",
    "src/lib/fantasy/optimiser.ts", "src/lib/fantasy/optimiser.test.ts",
    "src/lib/fantasy/ppg.ts", "src/lib/fantasy/ppg.test.ts",
    "src/lib/fantasy/coldstart.test.ts"
  ]
}
EOF
npx tsc -p .tmp-fantasy-tsconfig.json
set +e
node --test .tmp-fantasy-test/lib/fantasy/*.test.js
status1=$?
set -e

cat > .tmp-fantasy-tsconfig-tips.json <<'EOF'
{
  "compilerOptions": {
    "rootDir": "src", "outDir": ".tmp-fantasy-test-tips",
    "module": "commonjs", "moduleResolution": "node", "target": "es2022",
    "esModuleInterop": true, "skipLibCheck": true, "types": ["node"],
    "resolveJsonModule": true, "baseUrl": ".", "paths": { "@/*": ["src/*"] }
  },
  "include": [
    "src/lib/fantasy/values.ts", "src/lib/fantasy/engine.ts",
    "src/lib/fantasy/advice.ts", "src/lib/fantasy/news.ts",
    "src/lib/fantasy/tips.ts", "src/lib/fantasy/tips.test.ts"
  ]
}
EOF
npx tsc -p .tmp-fantasy-tsconfig-tips.json
set +e
node --conditions=react-server --test .tmp-fantasy-test-tips/lib/fantasy/tips.test.js
status2=$?
set -e

if [ "$status1" -ne 0 ] || [ "$status2" -ne 0 ]; then
  echo "fantasy tests FAILED (engine/months/advice: $status1, tips: $status2)"
  exit 1
fi
exit 0
