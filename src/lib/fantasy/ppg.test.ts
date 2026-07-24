import { test } from "node:test";
import assert from "node:assert/strict";
// Extensionless import matches the repo's other lib tests (src/lib/questions.test.ts,
// src/lib/draft/*.test.ts) and keeps `tsc --noEmit` clean. Run under the same bare-tsc harness:
//   npx tsc src/lib/fantasy/ppg.ts src/lib/fantasy/ppg.test.ts --outDir /tmp/ppg \
//     --module commonjs --target es2022 --esModuleInterop --skipLibCheck \
//     && node --test /tmp/ppg/ppg.test.js
import { pointsPerAppearance } from "./ppg";

// ── The failure this guards against ─────────────────────────────────────────
// fantasy_fpl_snapshot.total_points is a LAST-SEASON figure (verified 24 Jul: a
// player reads 209 points there while zero 26/27 matches have been played).
// pointsPerAppearance must only ever be driven by fantasy_player_scores rows
// (fields: gw, player_id, points, minutes) — a stray `total_points` field must
// have zero effect on the output, even if a caller accidentally spreads a
// snapshot-shaped object into the input array.

test("computes points per appearance from fantasy_player_scores rows", () => {
  const rows = [
    { gw: 1, player_id: 1, points: 6, minutes: 90 },
    { gw: 2, player_id: 1, points: 2, minutes: 90 },
    { gw: 3, player_id: 1, points: 0, minutes: 0 }, // did not play — not an appearance
  ];
  const result = pointsPerAppearance(rows);
  assert.equal(result.get(1), 4, "(6 + 2) / 2 appearances = 4, the GW with 0 minutes must not count");
});

test("a player with zero appearances scores 0, not NaN", () => {
  const rows = [{ gw: 1, player_id: 2, points: 0, minutes: 0 }];
  const result = pointsPerAppearance(rows);
  assert.equal(result.get(2), 0);
});

test("a stray last-season total_points field on the input cannot influence the output", () => {
  // Shaped like a fantasy_player_scores row PLUS a decoy field that only exists
  // on fantasy_fpl_snapshot rows. If pointsPerAppearance ever starts reading
  // total_points instead of points, this test catches it immediately.
  const rows = [
    { gw: 1, player_id: 3, points: 4, minutes: 90, total_points: 209 },
    { gw: 2, player_id: 3, points: 6, minutes: 90, total_points: 209 },
  ];
  const result = pointsPerAppearance(rows);
  assert.equal(result.get(3), 5, "must be (4 + 6) / 2 = 5 from `points`, never derived from total_points (209)");
});
