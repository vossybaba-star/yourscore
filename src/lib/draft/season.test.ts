/** Season-model tests. Run via scripts/draft/run-tests.sh. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { preSeasonOdds, simulateSeason, type Opponent } from "./season";
import { slotsFor } from "./formations";
import type { Formation, PlacedPlayer } from "./types";

// The real FC26 Premier League strengths (FIFA-derived), as the simulator uses.
const OPP: Opponent[] = [86, 86, 86, 83, 82, 82, 82, 82, 80, 80, 80, 79, 79, 79, 79, 79, 78, 77, 76]
  .map((s, i) => ({ name: `Club ${i}`, strength: s }));

function xi(formation: Formation, overall: number): PlacedPlayer[] {
  return slotsFor(formation).map((s, i) => ({
    slot: s.id, slotPos: s.pos, player_season_id: `p${i}`, name: `Player ${i}`,
    club: "Club", season: "2025/26", overall, position: s.pos,
  }));
}

test("preSeasonOdds: better teams have better markets", () => {
  const weak = preSeasonOdds(xi("4-3-3", 72), 72, OPP);
  const strong = preSeasonOdds(xi("4-3-3", 90), 90, OPP);
  assert.ok(strong.expectedPoints > weak.expectedPoints);
  assert.ok(strong.winLeague > weak.winLeague);
  assert.ok(strong.relegation < weak.relegation);
  for (const o of [weak, strong]) {
    for (const v of [o.winLeague, o.top4, o.top6, o.top10, o.relegation]) assert.ok(v >= 0 && v <= 100, `pct ${v}`);
    assert.ok(o.projectedFinish >= 1 && o.projectedFinish <= 20);
  }
});

test("simulateSeason: a consistent 38-game season", () => {
  const r = simulateSeason(xi("4-3-3", 85), "4-3-3", 85, "seed-1", OPP);
  assert.equal(r.games.length, 38);
  assert.equal(r.wins + r.draws + r.losses, 38);
  assert.equal(r.points, r.wins * 3 + r.draws);
  assert.equal(r.gd, r.gf - r.ga);
  assert.ok(r.position >= 1 && r.position <= 20);
  assert.equal(r.players.reduce((s, p) => s + p.goals, 0), r.gf, "player goals == gf");
  assert.ok(r.goldenBoot === null || r.goldenBoot.goals > 0);
});

test("simulateSeason: deterministic for a given seed", () => {
  const a = simulateSeason(xi("4-4-2", 80), "4-4-2", 80, "same", OPP);
  const b = simulateSeason(xi("4-4-2", 80), "4-4-2", 80, "same", OPP);
  assert.deepEqual({ p: a.points, gf: a.gf, pos: a.position }, { p: b.points, gf: b.gf, pos: b.position });
});

test("simulateSeason: finish tracks quality vs the real FIFA league", () => {
  const avg = (ovr: number) => {
    let pts = 0, pos = 0;
    for (let i = 0; i < 40; i++) { const r = simulateSeason(xi("4-3-3", ovr), "4-3-3", ovr, `b${ovr}-${i}`, OPP); pts += r.points; pos += r.position; }
    return { pts: pts / 40, pos: pos / 40 };
  };
  const elite = avg(88);  // better than every real club
  const mid = avg(80);    // league average
  const weak = avg(74);   // below every real club
  assert.ok(elite.pts > mid.pts + 12 && mid.pts > weak.pts + 8, `pts elite>${elite.pts} mid>${mid.pts} weak>${weak.pts}`);
  assert.ok(elite.pos < mid.pos && mid.pos < weak.pos, `pos elite ${elite.pos} mid ${mid.pos} weak ${weak.pos}`);
  assert.ok(elite.pos <= 5, `elite avg finish ${elite.pos}`);
  assert.ok(weak.pos >= 14, `weak avg finish ${weak.pos}`);
});

// Brand guard: going 38-0 (all 38 wins, no draws) must stay rare — achievable only by
// a near-perfect XI, and even then seldom. Heavy (large N) so it is env-gated.
if (process.env.DRAFT_CALIBRATION) {
  test("invincible 38-0 stays rare", () => {
    const rate = (ovr: number, N: number) => {
      let inv = 0;
      for (let i = 0; i < N; i++) if (simulateSeason(xi("4-3-3", ovr), "4-3-3", ovr, `inv${ovr}-${i}`, OPP).invincible) inv++;
      return inv / N;
    };
    assert.ok(rate(88, 8000) < 0.005, "an 88 XI virtually never goes 38-0");
    const r96 = rate(96, 8000);
    assert.ok(r96 > 0.001 && r96 < 0.03, `a 96 XI goes 38-0 rarely but possibly, got ${(r96 * 100).toFixed(2)}%`);
  });
}
