/**
 * Draft XI scoring tests. Run: `node --test src/lib/draft/score.test.ts`
 * (Node 24 strips the TS types natively.)
 *
 * These double as the tuning harness: hand-built teams across the quality range
 * assert the curve lands strong XIs in the right tiers, keeps Invincible rare,
 * and keeps the H2H upset rate dramatic-but-fair.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fitMultiplier, canPlay, scoreTeam, projectSeason,
  winProbability, resolveH2H, seededRng, chemistry, playerIdentity,
} from "./score";
import { slotsFor } from "./formations";
import type { Formation, PlacedPlayer, Position } from "./types";

test("playerIdentity collapses one player's edition name-forms, keeps distinct players apart", () => {
  // The bug: same player, different edition name strings → must be ONE identity.
  assert.equal(playerIdentity("Cristiano Ronaldo"), playerIdentity("C. Ronaldo"));
  assert.equal(playerIdentity("Wayne Rooney"), playerIdentity("W. Rooney"));
  assert.equal(playerIdentity("Trent Alexander-Arnold"), playerIdentity("T. Alexander-Arnold"));
  // Genuinely different people stay distinct.
  assert.notEqual(playerIdentity("Gary Neville"), playerIdentity("Phil Neville"));
  assert.notEqual(playerIdentity("Cristiano Ronaldo"), playerIdentity("Ronaldo")); // CR7 vs the Brazilian
  assert.equal(playerIdentity("Ronaldinho"), "ronaldinho"); // single-name player
});

// Build an XI by assigning each slot a player of a given overall. `posMap`/`overallMap`
// override per-slot player position/overall; defaults: player plays the slot exactly.
function buildXI(
  formation: Formation,
  overall: number | number[],
  opts: { pos?: Record<string, Position>; ovr?: Record<string, number>; club?: string; season?: string } = {}
): PlacedPlayer[] {
  const slots = slotsFor(formation);
  return slots.map((s, i) => ({
    slot: s.id,
    slotPos: s.pos,
    player_season_id: `p-${s.id}`,
    name: `Player ${s.id}`,
    club: opts.club ?? `Club ${i}`,
    season: opts.season ?? `20${10 + (i % 9)}/1${i % 9}`,
    overall: opts.ovr?.[s.id] ?? (Array.isArray(overall) ? overall[i] : overall),
    position: opts.pos?.[s.id] ?? s.pos,
  }));
}

test("fit tiers", () => {
  assert.equal(fitMultiplier("ST", "ST"), 1.0);
  assert.equal(fitMultiplier("RWB", "RB"), 0.92, "wing-back covers full-back");
  assert.equal(fitMultiplier("CB", "RB"), 0.82, "same line, workable cover");
  assert.equal(fitMultiplier("RW", "CB"), 0.55, "winger cannot fill CB (diff line)");
  assert.equal(fitMultiplier("CM", "ST"), 0.55, "midfielder cannot be a striker");
  assert.equal(fitMultiplier("GK", "ST"), 0.55, "GK useless outfield");
  assert.equal(fitMultiplier("ST", "GK"), 0.55, "striker useless in goal");
  // strict lines: only same-category placements are legal
  assert.equal(canPlay("RW", "CB"), false, "attacker can't defend");
  assert.equal(canPlay("CM", "ST"), false, "midfielder can't be a striker");
  assert.equal(canPlay("ST", "LW"), true, "forward can play left wing");
  assert.equal(canPlay("RWB", "RB"), true, "defender lines interchange");
  assert.equal(canPlay("CDM", "CAM"), true, "midfielders interchange");
});

test("strength scales with overall, perfect-fit XI", () => {
  const weak = scoreTeam(buildXI("4-3-3", 62), "4-3-3");
  const mid = scoreTeam(buildXI("4-3-3", 78), "4-3-3");
  const strong = scoreTeam(buildXI("4-3-3", 88), "4-3-3");
  const elite = scoreTeam(buildXI("4-3-3", 94), "4-3-3");
  assert.ok(weak < mid && mid < strong && strong < elite, `${weak} ${mid} ${strong} ${elite}`);
  // perfect-fit XI of overall N should land near N (chemistry can nudge up a touch)
  assert.ok(Math.abs(strong - 88) < 5, `strong=${strong}`);
});

test("out-of-position XI scores worse than in-position", () => {
  const good = scoreTeam(buildXI("4-3-3", 85), "4-3-3");
  // Put a winger at CB and a CB at ST — both "wrong" fits.
  const bad = scoreTeam(
    buildXI("4-3-3", 85, { pos: { rcb: "RW", st: "CB" } }),
    "4-3-3"
  );
  assert.ok(bad < good - 5, `good=${good} bad=${bad}`);
});

test("missing GK is punished", () => {
  const withGk = scoreTeam(buildXI("4-4-2", 80), "4-4-2");
  const noGk = scoreTeam(buildXI("4-4-2", 80, { pos: { gk: "CB" } }), "4-4-2");
  assert.ok(noGk < withGk - 6, `withGk=${withGk} noGk=${noGk}`);
});

test("chemistry rewards clubmates but is capped at +6", () => {
  const spread = chemistry(buildXI("4-3-3", 80));
  const oneClub = chemistry(buildXI("4-3-3", 80, { club: "Arsenal", season: "2003/04" }));
  assert.ok(oneClub > spread);
  assert.ok(oneClub <= 6.0001, `chem=${oneClub}`);
});

test("tiers map to plausible seasons", () => {
  const elite = projectSeason(scoreTeam(buildXI("4-3-3", 93), "4-3-3"));
  assert.ok(["Champions", "Centurions", "INVINCIBLE"].includes(elite.tier), elite.tier);
  const mid = projectSeason(scoreTeam(buildXI("4-3-3", 74), "4-3-3"));
  assert.ok(["Europe", "Mid-table", "Title Challengers"].includes(mid.tier), `${mid.tier} pts=${mid.points}`);
  const weak = projectSeason(scoreTeam(buildXI("4-3-3", 60), "4-3-3"));
  assert.ok(["Relegated", "Relegation Battle", "Mid-table"].includes(weak.tier), `${weak.tier} pts=${weak.points}`);
  // projection internally consistent
  for (const s of [55, 65, 75, 85, 95]) {
    const p = projectSeason(s);
    assert.equal(p.wins + p.draws + p.losses, 38, `games at strength ${s}`);
    assert.equal(p.points, p.wins * 3 + p.draws);
    assert.ok(p.position >= 1 && p.position <= 20);
  }
});

test("Invincible is rare — only a near-perfect XI reaches 38-0", () => {
  // A realistic elite XI from random spins: 95-overall but spread across clubs
  // (little chemistry). Should be Centurions-class, NOT auto-Invincible.
  const s95 = scoreTeam(buildXI("4-3-3", 95), "4-3-3");
  const p95 = projectSeason(s95);
  assert.notEqual(p95.tier, "INVINCIBLE", `spread 95 XI (strength ${s95}) should not be Invincible`);
  assert.ok(["Champions", "Centurions"].includes(p95.tier), `got ${p95.tier} pts=${p95.points}`);

  // The ceiling — an all-99 perfect-fit, single-club XI (the Invincibles!) —
  // MAY reach 38-0. This is the ~1-in-200 dream, not the default.
  const ceil = projectSeason(scoreTeam(buildXI("4-3-3", 99, { club: "Dream", season: "2025/26" }), "4-3-3"));
  assert.equal(ceil.tier, "INVINCIBLE", `all-99 single-club XI should be able to go Invincible`);
});

test("H2H favours the stronger team but allows upsets", () => {
  assert.ok(Math.abs(winProbability(80, 80) - 0.5) < 1e-9);
  assert.ok(winProbability(86, 79) > 0.5);
  // A 6-point edge: strong but not a lock (upsets stay possible).
  const pEdge = winProbability(85, 79);
  assert.ok(pEdge > 0.7 && pEdge < 0.92, `pEdge=${pEdge}`);

  // Empirical upset rate over many seeded games at a 6-pt edge.
  let upsets = 0;
  const N = 4000;
  for (let i = 0; i < N; i++) {
    const w = resolveH2H(85, 79, seededRng(`m${i}`));
    if (w === "B") upsets++;
  }
  const rate = upsets / N;
  assert.ok(rate > 0.08 && rate < 0.3, `upset rate at 6pts = ${rate}`);
});

test("seededRng is deterministic", () => {
  const a = seededRng("match-123");
  const b = seededRng("match-123");
  assert.equal(a(), b());
  assert.equal(resolveH2H(80, 75, seededRng("x")), resolveH2H(80, 75, seededRng("x")));
});

test("partial squad scores without crashing (live preview)", () => {
  const partial = buildXI("4-3-3", 84).slice(0, 5);
  const s = scoreTeam(partial, "4-3-3");
  assert.ok(s > 0 && s < 99, `partial=${s}`);
});
