#!/usr/bin/env bash
# Integration test for the gameday-credit sweep (gamedayEarn), run against an
# in-memory fake of the Supabase query surface. It exercises the REAL function,
# so it lives apart from run-tests.sh (pure engine): gameday-credit.ts opens with
# `import "server-only"`, which throws under node, so we strip that one line and
# stub the type-only ./season import before compiling. Same compile-to-CJS +
# node --test approach as the other fantasy test runners.
set -euo pipefail
cd "$(dirname "$0")/../.."

T=.tmp-gdc
rm -rf "$T"; mkdir -p "$T"
cp src/lib/fantasy/values.ts src/lib/fantasy/engine.ts src/lib/fantasy/gameday-credit.test.ts "$T/"
sed '/^import "server-only";/d' src/lib/fantasy/gameday-credit.ts > "$T/gameday-credit.ts"
cat > "$T/season.ts" <<'EOF'
export interface SeasonGw { gw: number; season: string; mode: string; window_start: string; window_end: string; deadline: string | null; status: string; sm_season_id: number }
EOF

npx tsc "$T/values.ts" "$T/engine.ts" "$T/season.ts" "$T/gameday-credit.ts" "$T/gameday-credit.test.ts" \
  --outDir "$T/out" --module commonjs --target es2022 --moduleResolution node --esModuleInterop --skipLibCheck

node --test "$T/out/gameday-credit.test.js"
code=$?
rm -rf "$T"
exit $code
