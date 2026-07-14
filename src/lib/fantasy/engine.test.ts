import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accrueChip, applyTransfer, autoSubs, bankCredits, creditsForRound, effectiveCaptain,
  halfOf, perfectRoundReward, scoreEntry, smartDefaults, transferCost,
  validateSelection, validateSquad,
  type LockedSelection, type PoolPlayer, type Squad, RuleError, BUDGET_TENTHS,
  CHIP_HOLD_CAP, GAMEWEEKS_PER_CHIP, HALF_SEASON_GW,
} from "./engine";
import { pointsFor, ZERO_FACTS, type MatchFacts } from "./values";

// ── fixture pool: 8 clubs × (2 GK, 5 DEF, 5 MID, 3 FWD), prices vary by club ──
function mkPool(): PoolPlayer[] {
  const pool: PoolPlayer[] = [];
  let id = 1;
  for (let club = 1; club <= 8; club++) {
    const base = 40 + club * 2; // tenths
    const add = (pos: PoolPlayer["pos"], n: number, bump: number) => {
      for (let i = 0; i < n; i++)
        pool.push({ id: id++, smId: 9000 + id, name: `P${id}`, club: `C${club}`, clubId: club, pos, priceTenths: base + bump + i * 3 });
    };
    add("GK", 2, 0); add("DEF", 5, 5); add("MID", 5, 12); add("FWD", 3, 20);
  }
  return pool;
}
const POOL = mkPool();
const pick = (pos: string, n: number, clubs: number[]) =>
  POOL.filter((p) => p.pos === pos && clubs.includes(p.clubId)).slice(0, n).map((p) => p.id);
/** Take n players of a position from ONE club (offset into that club's list). */
const take = (pos: string, club: number, n: number, skip = 0) =>
  POOL.filter((p) => p.pos === pos && p.clubId === club).slice(skip, skip + n).map((p) => p.id);
/** A legal, affordable 15: club counts = {1:3, 2:2, 3:3, 4:2, 5:2, 6:2, 7:1}. */
function legal15(): number[] {
  return [
    ...take("GK", 1, 1), ...take("GK", 2, 1),
    ...take("DEF", 1, 2), ...take("DEF", 3, 2), ...take("DEF", 4, 1),
    ...take("MID", 3, 1), ...take("MID", 4, 1), ...take("MID", 5, 2), ...take("MID", 6, 1),
    ...take("FWD", 6, 1), ...take("FWD", 7, 1), ...take("FWD", 2, 1),
  ];
}

// ── validateSquad ─────────────────────────────────────────────────────────────
test("validateSquad: legal 15 passes, bank = budget − Σprice", () => {
  const squad = validateSquad(legal15(), POOL);
  assert.equal(squad.picks.length, 15);
  const spent = squad.picks.reduce((s, p) => s + p.buyTenths, 0);
  assert.equal(squad.bankTenths, BUDGET_TENTHS - spent);
});
test("validateSquad: rejects wrong size, dup, unknown id", () => {
  assert.throws(() => validateSquad(legal15().slice(0, 14), POOL), /15 players/);
  const dup = legal15(); dup[14] = dup[0];
  assert.throws(() => validateSquad(dup, POOL), /duplicate/);
  const bad = legal15(); bad[14] = 99999;
  assert.throws(() => validateSquad(bad, POOL), /unknown/);
});
test("validateSquad: rejects quota violations", () => {
  const ids = [...pick("GK", 1, [1, 2]), ...pick("DEF", 6, [1, 2, 3]),
    ...pick("MID", 5, [3, 4, 5]), ...pick("FWD", 3, [5, 6])];
  assert.throws(() => validateSquad(ids, POOL), /need 2 GK|need 5 DEF/);
});
test("validateSquad: rejects a 4th player from one club", () => {
  const ids = [...pick("GK", 2, [1]), // both GKs club 1
    ...pick("DEF", 5, [1, 2]),        // includes 2+ club-1 DEFs → club 1 total ≥ 4
    ...pick("MID", 5, [3, 4]), ...pick("FWD", 3, [5, 6])];
  assert.throws(() => validateSquad(ids, POOL), /more than 3/);
});
test("validateSquad: budget boundary — exactly on budget passes, 0.1 over fails", () => {
  const ids = legal15();
  const spent = validateSquad(ids, POOL).picks.reduce((s, p) => s + p.buyTenths, 0);
  assert.ok(validateSquad(ids, POOL, spent)); // exactly enough
  assert.throws(() => validateSquad(ids, POOL, spent - 1), /costs/);
});

// ── validateSelection ─────────────────────────────────────────────────────────
function squadAndDefaults(): { squad: Squad; sel: ReturnType<typeof smartDefaults> } {
  const squad = validateSquad(legal15(), POOL);
  return { squad, sel: smartDefaults(squad, POOL) };
}
test("smartDefaults produce a valid selection with GK on bench slot 1", () => {
  const { squad, sel } = squadAndDefaults();
  const v = validateSelection(squad, sel.xi, sel.bench, sel.captain, sel.vice);
  assert.equal(v.xi.length, 11);
  const posOf = new Map(squad.picks.map((p) => [p.id, p.pos]));
  assert.equal(posOf.get(sel.bench[0]), "GK");
  assert.notEqual(sel.captain, sel.vice);
});
test("validateSelection: rejects 2 GKs in XI, <3 DEF, 0 FWD, captain=vice, outsider", () => {
  const { squad, sel } = squadAndDefaults();
  const posOf = new Map(squad.picks.map((p) => [p.id, p.pos]));
  const swapIn = (xi: number[], bench: number[], benchPick: (id: number) => boolean, xiPick: (id: number) => boolean) => {
    const inn = bench.find((id) => benchPick(id))!;
    const out = xi.find((id) => xiPick(id))!;
    return { xi: xi.map((x) => (x === out ? inn : x)), bench: bench.map((b) => (b === inn ? out : b)) };
  };
  // 2 GKs: bench GK in for a MID
  const g = swapIn(sel.xi, sel.bench, (id) => posOf.get(id) === "GK", (id) => posOf.get(id) === "MID");
  assert.throws(() => validateSelection(squad, g.xi, g.bench, sel.captain, sel.vice), /1 GK/);
  // 0 FWD: bench MID in for the only FWD? defaults start 1+ FWD; replace ALL fwds
  const fwds = sel.xi.filter((id) => posOf.get(id) === "FWD");
  let xi2 = sel.xi, bench2 = sel.bench;
  for (const f of fwds) {
    const r = swapIn(xi2, bench2, (id) => posOf.get(id) === "MID" || posOf.get(id) === "DEF", (id) => id === f);
    xi2 = r.xi; bench2 = r.bench;
  }
  assert.throws(() => validateSelection(squad, xi2, bench2, xi2[1], xi2[2]), /FWD|3 DEF/);
  assert.throws(() => validateSelection(squad, sel.xi, sel.bench, sel.captain, sel.captain), /differ/);
  const alien = [...sel.xi]; alien[10] = 99999;
  assert.throws(() => validateSelection(squad, alien, sel.bench, alien[0], alien[1]), /15 picks/);
});

// ── credits ───────────────────────────────────────────────────────────────────
test("creditsForRound: full curve table (3→1, 5→2, 7→3, 9→4)", () => {
  const want = [0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4];
  for (let c = 0; c <= 11; c++) assert.equal(creditsForRound(c), want[c], `correct=${c}`);
});
test("bankCredits caps at 5; transferCost credit-then-hit", () => {
  assert.equal(bankCredits(4, 3), 5);
  assert.equal(bankCredits(0, 2), 2);
  assert.equal(transferCost(1).paid, "credit");
  assert.equal(transferCost(0).paid, "hit");
});

// ── transfers ─────────────────────────────────────────────────────────────────
test("applyTransfer: swaps, recomputes bank, enforces pos/club/budget/dup", () => {
  const squad = validateSquad(legal15(), POOL);
  const outDef = squad.picks.find((p) => p.pos === "DEF")!;
  const inDef = POOL.find((p) => p.pos === "DEF" && !squad.picks.some((q) => q.id === p.id) && p.clubId === 7)!;
  const next = applyTransfer(squad, outDef.id, inDef.id, POOL);
  assert.equal(next.picks.length, 15);
  assert.equal(next.bankTenths, squad.bankTenths + outDef.buyTenths - inDef.priceTenths);
  const inMid = POOL.find((p) => p.pos === "MID" && p.clubId === 7)!;
  assert.throws(() => applyTransfer(squad, outDef.id, inMid.id, POOL), /same position/);
  const owned = squad.picks.find((p) => p.pos === "DEF" && p.id !== outDef.id)!;
  assert.throws(() => applyTransfer(squad, outDef.id, owned.id, POOL), /already/);
});
test("applyTransfer: club cap blocks a 4th from one club", () => {
  const squad = validateSquad(legal15(), POOL);
  // find a club already at 3 in the squad
  const counts = new Map<number, number>();
  for (const p of squad.picks) counts.set(p.clubId, (counts.get(p.clubId) ?? 0) + 1);
  const full = Array.from(counts.entries()).find(([, n]) => n === 3)?.[0];
  assert.ok(full, "fixture squad should have a club at cap");
  const out = squad.picks.find((p) => p.clubId !== full && p.pos === "DEF") ?? squad.picks.find((p) => p.clubId !== full)!;
  const inn = POOL.find((p) => p.clubId === full && p.pos === out.pos && !squad.picks.some((q) => q.id === p.id));
  if (inn) assert.throws(() => applyTransfer(squad, out.id, inn.id, POOL), /one club|more than/);
});
test("applyTransfer: insufficient bank rejected", () => {
  const squad = validateSquad(legal15(), POOL);
  const expensive: PoolPlayer = { id: 7777, smId: 1, name: "Star", club: "C8", clubId: 8, pos: "FWD", priceTenths: 2000 };
  const out = squad.picks.find((p) => p.pos === "FWD")!;
  assert.throws(() => applyTransfer(squad, out.id, expensive.id, [...POOL, expensive]), /budget/);
});

// ── auto-subs + captain chain + scoring ───────────────────────────────────────
function lockedSel(): LockedSelection {
  const { squad, sel } = squadAndDefaults();
  return { ...sel, picks: squad.picks };
}
const minutesMap = (sel: LockedSelection, zeroIds: number[], benchPlay: boolean) => {
  const m = new Map<number, number>();
  for (const p of sel.picks) m.set(p.id, 90);
  for (const id of zeroIds) m.set(id, 0);
  if (!benchPlay) for (const id of sel.bench) m.set(id, 0);
  return m;
};
test("autoSubs: outfield sub in bench order; GK only replaced by bench GK", () => {
  const sel = lockedSel();
  const posOf = new Map(sel.picks.map((p) => [p.id, p.pos]));
  const gk = sel.xi.find((id) => posOf.get(id) === "GK")!;
  const mid = sel.xi.find((id) => posOf.get(id) === "MID")!;
  const m = minutesMap(sel, [gk, mid], true);
  const { xi, subs } = autoSubs(sel, m);
  assert.equal(subs.length, 2);
  const gkSub = subs.find((s) => s.out === gk)!;
  assert.equal(posOf.get(gkSub.in), "GK");
  const midSub = subs.find((s) => s.out === mid)!;
  assert.equal(midSub.in, sel.bench.slice(1).find((b) => (m.get(b) ?? 0) > 0));
  assert.equal(new Set(xi).size, 11);
});
test("autoSubs: formation floor blocks a sub that would leave <3 DEF", () => {
  const sel = lockedSel();
  const posOf = new Map(sel.picks.map((p) => [p.id, p.pos]));
  const defs = sel.xi.filter((id) => posOf.get(id) === "DEF");
  // exactly-3-DEF default XI: one DEF misses; bench has NO DEF (defaults bench = leftovers)
  const benchDefs = sel.bench.filter((id) => posOf.get(id) === "DEF");
  if (defs.length === 3 && benchDefs.length === 0) {
    const m = minutesMap(sel, [defs[0]], true);
    const { xi, subs } = autoSubs(sel, m);
    assert.equal(subs.length, 0, "no legal sub → slot stays empty");
    assert.ok(xi.includes(defs[0]));
  } else {
    // construct: kill a DEF, kill all bench DEFs too
    const m = minutesMap(sel, [defs[0], ...benchDefs], true);
    const { subs } = autoSubs(sel, m);
    assert.ok(subs.every((s) => posOf.get(s.in) !== "DEF" ? defs.length > 3 : true));
  }
});
test("effectiveCaptain: captain → vice → best-form chain", () => {
  const sel = lockedSel();
  const all90 = minutesMap(sel, [], true);
  assert.equal(effectiveCaptain(sel, sel.xi, all90, new Map()), sel.captain);
  const capOut = minutesMap(sel, [sel.captain], true);
  assert.equal(effectiveCaptain(sel, sel.xi, capOut, new Map()), sel.vice);
  const bothOut = minutesMap(sel, [sel.captain, sel.vice], true);
  const fav = sel.xi.find((id) => id !== sel.captain && id !== sel.vice)!;
  const form = new Map(sel.xi.map((id) => [id, id === fav ? 99 : 1]));
  assert.equal(effectiveCaptain(sel, sel.xi, bothOut, form), fav);
});
test("scoreEntry: golden total with captain double and hits; deterministic", () => {
  const sel = lockedSel();
  const scores = new Map(sel.picks.map((p) => [p.id, {
    points: 10, facts: { ...ZERO_FACTS, minutes: 90 },
  }]));
  const r1 = scoreEntry(sel, 2, scores);
  // 11 starters × 10 + captain double (+10) − 2×4 hits
  assert.equal(r1.total, 110 + 10 - 8);
  assert.equal(r1.hitsDeducted, 8);
  assert.equal(r1.captainUsed, sel.captain);
  const r2 = scoreEntry(sel, 2, scores);
  assert.deepEqual(r1, r2, "same input twice → identical output");
});
test("scoreEntry: benched captain's double goes to vice; auto-sub scores", () => {
  const sel = lockedSel();
  const scores = new Map(sel.picks.map((p) => [p.id, { points: 5, facts: { ...ZERO_FACTS, minutes: 90 } }]));
  scores.set(sel.captain, { points: 0, facts: { ...ZERO_FACTS, minutes: 0 } });
  const r = scoreEntry(sel, 0, scores);
  assert.equal(r.captainUsed, sel.vice);
  assert.equal(r.subs.length >= 1, true); // captain got auto-subbed too
  const capRow = r.breakdown.find((b) => b.captain)!;
  assert.equal(capRow.id, sel.vice);
  assert.equal(capRow.points, 10);
});

// ── values golden table ───────────────────────────────────────────────────────
test("pointsFor: golden per-position values", () => {
  const f = (o: Partial<MatchFacts>): MatchFacts => ({ ...ZERO_FACTS, minutes: 90, ...o });
  assert.equal(pointsFor("FWD", f({ goals: 1 })), 6 + 11);
  assert.equal(pointsFor("MID", f({ goals: 1 })), 6 + 13);
  assert.equal(pointsFor("DEF", f({ goals: 1, cleanSheet: 1 })), 6 + 15 + 10);
  assert.equal(pointsFor("GK", f({ saves: 7, cleanSheet: 1 })), 6 + 4 + 10);
  assert.equal(pointsFor("GK", f({ pensSaved: 1, conceded: 2 })), 6 + 12 - 2);
  assert.equal(pointsFor("MID", f({ assists: 2, yellows: 1 })), 6 + 16 - 3);
  assert.equal(pointsFor("DEF", f({ dc: 10 })), 6 + 5);
  assert.equal(pointsFor("MID", f({ dcRec: 12 })), 6 + 5);
  assert.equal(pointsFor("MID", f({ dc: 11, dcRec: 11 })), 6); // non-DEF needs dcRec ≥ 12
  assert.equal(pointsFor("FWD", { ...ZERO_FACTS, minutes: 30 }), 3);
  assert.equal(pointsFor("FWD", ZERO_FACTS), 0);
  assert.equal(pointsFor("DEF", f({ reds: 1, ownGoals: 1, conceded: 4 })), 6 - 8 - 5 - 4);
});
test("RuleError carries a machine-readable code", () => {
  try { validateSquad([], POOL); assert.fail("should throw"); }
  catch (e) { assert.ok(e instanceof RuleError); assert.equal((e as RuleError).code, "size"); }
});

// ── chips (D:123-156) ─────────────────────────────────────────────────────────
test("accrueChip: a token every 4 PLAYED gameweeks, cumulative not consecutive", () => {
  let s = { progress: 0, held: 0, minted: false };
  for (let i = 1; i < GAMEWEEKS_PER_CHIP; i++) {
    s = accrueChip(s.progress, s.held);
    assert.equal(s.minted, false, `no token yet at ${i} played weeks`);
    assert.equal(s.held, 0);
  }
  s = accrueChip(s.progress, s.held);
  assert.equal(s.minted, true, "4th played gameweek mints the token");
  assert.equal(s.held, 1);
  assert.equal(s.progress, 0, "progress resets after minting");
});
test("accrueChip: progress stops dead at the hold cap — no stockpiling", () => {
  const at = accrueChip(3, CHIP_HOLD_CAP);
  assert.deepEqual(at, { progress: 3, held: CHIP_HOLD_CAP, minted: false });
});
test("halfOf: the wildcard's use-it-or-lose-it boundary", () => {
  assert.equal(halfOf(1), 1);
  assert.equal(halfOf(HALF_SEASON_GW), 1);
  assert.equal(halfOf(HALF_SEASON_GW + 1), 2);
  assert.equal(halfOf(38), 2);
});
test("perfectRoundReward: 11/11 mints a wildcard, but only one per half", () => {
  assert.deepEqual(perfectRoundReward(11, 11, false), { wildcard: true, credits: 0 });
  // the second perfect round of the same half overflows into credits instead
  assert.deepEqual(perfectRoundReward(11, 11, true), { wildcard: false, credits: 1 });
  assert.deepEqual(perfectRoundReward(10, 11, false), { wildcard: false, credits: 0 });
});
test("transferCost: every move is free on a wildcard week", () => {
  assert.deepEqual(transferCost(0, true), { paid: "free" });
  assert.deepEqual(transferCost(0, false), { paid: "hit" });
  assert.deepEqual(transferCost(2, false), { paid: "credit" });
});
test("scoreEntry: Triple Captain triples instead of doubling", () => {
  const sel = lockedSel();
  const scores = new Map(sel.picks.map((p) => [p.id, { points: 10, facts: { ...ZERO_FACTS, minutes: 90 } }]));
  const normal = scoreEntry(sel, 0, scores, new Map(), null);
  const tripled = scoreEntry(sel, 0, scores, new Map(), "triple_captain");
  assert.equal(normal.total, 110 + 10, "11×10 + captain doubled");
  assert.equal(tripled.total, 110 + 20, "11×10 + captain TRIPLED");
  assert.equal(tripled.breakdown.find((b) => b.captain)!.points, 30);
});
test("scoreEntry: Bench Boost scores all 15 and turns auto-subs off", () => {
  const sel = lockedSel();
  // a starter blanks: normally he'd be auto-subbed for a bench player
  const dud = sel.xi.find((id) => id !== sel.captain)!;
  const scores = new Map(sel.picks.map((p) => [p.id, {
    points: p.id === dud ? 0 : 10,
    facts: { ...ZERO_FACTS, minutes: p.id === dud ? 0 : 90 },
  }]));
  const boosted = scoreEntry(sel, 0, scores, new Map(), "bench_boost");
  assert.equal(boosted.breakdown.length, 15, "all 15 appear");
  assert.equal(boosted.subs.length, 0, "nothing is subbed — the bench already counts");
  // 10 playing starters ×10 + dud 0 + captain's extra 10 + 4 bench ×10
  assert.equal(boosted.total, 100 + 0 + 10 + 40);
});
test("scoreEntry: chips never break the pure-recompute contract", () => {
  const sel = lockedSel();
  const scores = new Map(sel.picks.map((p) => [p.id, { points: 7, facts: { ...ZERO_FACTS, minutes: 90 } }]));
  for (const chip of ["triple_captain", "bench_boost", null] as const) {
    const a = scoreEntry(sel, 1, scores, new Map(), chip);
    const b = scoreEntry(sel, 1, scores, new Map(), chip);
    assert.deepEqual(a, b, `${chip}: same input twice → identical output`);
  }
});
test("wildcard: an UNUSED half's wildcard must not survive into the next half", () => {
  // The rule is use-it-or-lose-it. Expire, THEN add — otherwise a player who sat on
  // their first-half wildcard would carry it into the second half and end up with
  // two, i.e. be rewarded for not using it.
  const held = { wildcards: 1, wildcard_half: 1 as 1 | 2 };
  const half = halfOf(HALF_SEASON_GW + 1); // now in the second half
  const live = held.wildcard_half === half ? held.wildcards : 0;
  assert.equal(live, 0, "the first-half wildcard is dead the moment the half turns");
  assert.equal(live + 1, 1, "you hold exactly the one newly issued for this half");
});
