import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateFixtures, toPlayerScores } from "./ingest";
import { pointsFor, ZERO_FACTS, type MatchFacts } from "./values";

const facts = (o: Partial<MatchFacts>): MatchFacts => ({ ...ZERO_FACTS, ...o });

test("toPlayerScores: a DOUBLE gameweek scores EACH match and sums (FPL-style)", () => {
  // A defender who played two full games and kept a clean sheet in BOTH.
  const one = pointsFor("DEF", facts({ minutes: 90, cleanSheet: 1 })); // 6 appearance + 10 CS = 16
  const byPlayer = new Map<number, MatchFacts[]>([
    [100, [facts({ minutes: 90, cleanSheet: 1 }), facts({ minutes: 90, cleanSheet: 1 })]],
  ]);
  const { scores } = toPlayerScores(byPlayer, [{ id: 1, smId: 100, pos: "DEF", name: "x" }]);
  assert.equal(scores[0].points, one * 2, "each match scored and summed → 32, not one combined 16");
  // Merged facts (display) show both appearances and both clean sheets.
  assert.equal(scores[0].facts.minutes, 180);
  assert.equal(scores[0].facts.cleanSheet, 2);
});

test("toPlayerScores: a single-game week is unchanged", () => {
  const byPlayer = new Map<number, MatchFacts[]>([[100, [facts({ minutes: 90, goals: 1 })]]]);
  const { scores } = toPlayerScores(byPlayer, [{ id: 1, smId: 100, pos: "FWD", name: "x" }]);
  assert.equal(scores[0].points, pointsFor("FWD", facts({ minutes: 90, goals: 1 })));
});

test("aggregateFixtures: a player in two fixtures gets one facts entry per match", () => {
  const fx = (pid: number) => ({
    participants: [{ id: 1 }, { id: 2 }], scores: [],
    lineups: [{ player_id: pid, team_id: 1, details: [{ type: { name: "Minutes Played" }, data: { value: 90 } }] }],
  });
  const out = aggregateFixtures([fx(100), fx(100)] as unknown as Parameters<typeof aggregateFixtures>[0]);
  assert.equal(out.get(100)?.length, 2, "two fixtures → two per-match entries");
});
