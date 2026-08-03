#!/usr/bin/env bash
# Round-gate tests (isRoundOpen / roundOpensAt). gameweeks.ts opens with
# `import "server-only"`, which throws under node, so we strip that one line
# before compiling — same compile-to-CJS + node --test approach as
# run-gameday-credit-test.sh.
set -euo pipefail
cd "$(dirname "$0")/../.."

T=.tmp-gw-test
rm -rf "$T"; mkdir -p "$T"
sed '/^import "server-only";/d' src/lib/fantasy/gameweeks.ts > "$T/gameweeks.ts"
cp src/lib/fantasy/gameweeks.test.ts "$T/"

npx tsc "$T/gameweeks.ts" "$T/gameweeks.test.ts" \
  --outDir "$T/out" --module commonjs --target es2022 --moduleResolution node --esModuleInterop --skipLibCheck

node --test "$T/out/gameweeks.test.js"
code=$?
rm -rf "$T"
exit $code
