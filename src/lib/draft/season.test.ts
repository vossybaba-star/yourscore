/** Season-model tests. Run via scripts/draft/run-tests.sh. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { preSeasonOdds, simulateSeason } from "./season";
import { slotsFor } from "./formations";
import type { Formation, PlacedPlayer } from "./types";

function xi(formation: Formation, overall: number): PlacedPlayer[] {
  return slotsFor(formation).map((s, i) => ({
    slot: s.id, slotPos: s.pos, player_season_id: `p${i}`, name: `Player ${i}`,
    club: "Club", season: "2020/21", overall, position: s.pos,
  }));
}

test("preSeasonOdds: better teams have better markets", () => {
  const weak = preSeasonOdds(68);
  const strong = preSeasonOdds(90);
  assert.ok(strong.expectedPoints > weak.expectedPoints);
  assert.ok(strong.winLeague > weak.winLeague);
  assert.ok(strong.relegation < weak.relegation);
  assert.ok(weak.relegation > strong.relegation);
  for (const o of [weak, strong]) {
    for (const v of [o.winLeague, o.top4, o.top6, o.top10, o.relegation]) {
      assert.ok(v >= 0 && v <= 100, `pct in range: ${v}`);
    }
    assert.ok(o.projectedFinish >= 1 && o.projectedFinish <= 20);
  }
});

test("simulateSeason: a consistent 38-game season", () => {
  const r = simulateSeason(xi("4-3-3", 85), "4-3-3", 85, "seed-1");
  assert.equal(r.games.length, 38);
  assert.equal(r.wins + r.draws + r.losses, 38);
  assert.equal(r.points, r.wins * 3 + r.draws);
  assert.equal(r.gd, r.gf - r.ga);
  assert.ok(r.position >= 1 && r.position <= 20);
  // goals distributed to players sum to team goals for
  const playerGoals = r.players.reduce((s, p) => s + p.goals, 0);
  assert.equal(playerGoals, r.gf, `player goals ${playerGoals} == gf ${r.gf}`);
  assert.ok(r.goldenBoot === null || r.goldenBoot.goals > 0);
});

test("simulateSeason: deterministic for a given seed", () => {
  const a = simulateSeason(xi("4-4-2", 80), "4-4-2", 80, "same");
  const b = simulateSeason(xi("4-4-2", 80), "4-4-2", 80, "same");
  assert.deepEqual({ p: a.points, gf: a.gf, ga: a.ga, pos: a.position }, { p: b.points, gf: b.gf, ga: b.ga, pos: b.position });
});

test("simulateSeason: stronger teams average more points across seeds", () => {
  const avg = (ovr: number) => {
    let pts = 0;
    for (let i = 0; i < 20; i++) pts += simulateSeason(xi("4-3-3", ovr), "4-3-3", ovr, `s${i}`).points;
    return pts / 20;
  };
  assert.ok(avg(90) > avg(70) + 15, "a 90 XI should clearly out-point a 70 XI");
});

test("simulateSeason: avg points are in a believable band per quality (sim ~ projection)", () => {
  const avg = (ovr: number) => {
    let pts = 0;
    for (let i = 0; i < 40; i++) pts += simulateSeason(xi("4-3-3", ovr), "4-3-3", ovr, `b${ovr}-${i}`).points;
    return pts / 40;
  };
  const elite = avg(85);   // title-challenger quality
  const mid = avg(76);     // mid-table
  const weak = avg(68);    // relegation fodder
  assert.ok(elite >= 70 && elite <= 100, `elite avg pts ${elite}`);
  assert.ok(mid >= 38 && mid <= 62, `mid avg pts ${mid}`);
  assert.ok(weak <= 42, `weak avg pts ${weak}`);
});
