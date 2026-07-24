/**
 * THE COLD START (gameweeks 1-5, and strictly before anything has been scored).
 *
 * The launch-week guarantee, pinned as a test because it is the failure mode
 * this whole build exists to avoid: with no history, the planner must find
 * NOTHING and say so — never a confident-looking transfer plan assembled out of
 * zeroes.
 *
 * The captain tool DOES have a cold-start fallback (FPL's ep_next, labelled
 * Beta). The planner deliberately does not, and must not be given one:
 * captaincy reorders eleven players the manager already owns and the downside is
 * a worse multiplier, whereas a transfer spends money and a credit and cannot be
 * taken back.
 *
 * This reproduces planTransfersTx's exact chain — seasonAverageScores returning
 * null, the flat ProjectedPoints map built from it, planTransfers over that map
 * — with only the DB read removed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { seasonAverageScores } from "./ppg";
import { planTransfers, type ProjectedPoints } from "./optimiser";
import type { PoolPlayer, Squad } from "./engine";

// Rebuild EXACTLY what planTransfersTx does at gameweek 1, end to end, minus
// the DB read: no scored rows, gwsElapsed 0 -> null -> every player flat 0.
const POSN = { GK: 2, DEF: 5, MID: 5, FWD: 3 } as const;
const pool: PoolPlayer[] = [];
let id = 1;
(["GK", "DEF", "MID", "FWD"] as const).forEach((pos) => {
  for (let i = 0; i < 30; i++)
    pool.push({ id: id++, smId: id, name: `${pos}${i}`, club: `C${i % 12}`, clubId: i % 12, pos, priceTenths: 40 + i });
});
const picks: PoolPlayer[] = [];
(["GK", "DEF", "MID", "FWD"] as const).forEach((pos) => {
  picks.push(...pool.filter((p) => p.pos === pos).slice(0, POSN[pos]));
});
const squad: Squad = {
  picks: picks.map((p) => ({ id: p.id, pos: p.pos, clubId: p.clubId, buyTenths: p.priceTenths })),
  bankTenths: 500,
};

test("GW1 cold start: no scored rows means seasonAverageScores is null", () => {
  const avg = seasonAverageScores([], 1 - 1, pool.map((p) => p.id));
  assert.equal(avg, null, "gameweek 1 => gwsElapsed 0 => null, the signal that drives basis");
});

test("GW1 cold start: the planner finds NOTHING and reports it, rather than inventing a plan", () => {
  const avg = seasonAverageScores([], 0, pool.map((p) => p.id));
  // Exactly the line from planTransfersTx.
  const projected: ProjectedPoints = new Map(pool.map((p) => [p.id, [avg?.get(p.id) ?? 0]]));
  const basis = avg ? "season-to-date-average" : "no-history-yet";
  assert.equal(basis, "no-history-yet");

  const plan = planTransfers({
    squad, pool, projected, unavailable: new Set<number>(),
    credits: 5, weeklyFree: 0, wildcardActive: false,
    considering: squad.picks.slice(0, 5).map((p) => p.id),
  });
  assert.equal(plan.moves.length, 0, "a flat projection must produce NO moves");
  assert.equal(plan.hold, true, "and must say hold");
  assert.equal(plan.totalGain, 0);
  assert.equal(plan.hitsTaken, 0, "it must never take a points hit on no evidence");
  assert.ok(plan.perPlayer.every((v) => v.bestInId === null),
    "every marked player must come back 'nothing beats him', not a fabricated upgrade");
});

test("GW1 cold start: even on a WILDCARD the flat projection buys nothing", () => {
  const projected: ProjectedPoints = new Map(pool.map((p) => [p.id, [0]]));
  const plan = planTransfers({
    squad, pool, projected, unavailable: new Set<number>(),
    credits: 5, weeklyFree: 0, wildcardActive: true,
    considering: squad.picks.map((p) => p.id),
  });
  assert.equal(plan.moves.length, 0, "free transfers are still not a reason to churn a squad on no evidence");
});
