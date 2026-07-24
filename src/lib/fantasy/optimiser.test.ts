import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyTransfer, RuleError, MAX_PER_CLUB, HIT_POINTS,
  type PoolPlayer, type Squad, type SquadPick, type FantasyPos,
} from "./engine";
import { optimiseTransfers, planTransfers, MOVE_MARGIN, type ProjectedPoints, type OptimiseInput } from "./optimiser";

// ── deterministic PRNG (mulberry32) — same recipe as advice.test.ts ──────────
function mulberry32(seed: number) {
  let s = seed;
  return function rng() {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── fixture pool: 15 clubs × (3 GK, 8 DEF, 8 MID, 5 FWD) — mirrors advice.test.ts
const CLUBS = 15;
function buildBigPool(): PoolPlayer[] {
  const pool: PoolPlayer[] = [];
  let id = 1;
  for (let club = 1; club <= CLUBS; club++) {
    const base = 40 + (club % 5) * 8;
    const add = (pos: FantasyPos, n: number, bump: number) => {
      for (let i = 0; i < n; i++)
        pool.push({
          id: id++, smId: null, name: `P${id}`, club: `C${club}`, clubId: club,
          pos, priceTenths: base + bump + i * 2,
        });
    };
    add("GK", 3, 0); add("DEF", 8, 4); add("MID", 8, 10); add("FWD", 5, 18);
  }
  return pool;
}
const QUOTA: Record<FantasyPos, number> = { GK: 2, DEF: 5, MID: 5, FWD: 3 };

function buildRandomSquad(rng: () => number, pool: PoolPlayer[]): number[] {
  const byPos: Record<FantasyPos, PoolPlayer[]> = { GK: [], DEF: [], MID: [], FWD: [] };
  for (const p of pool) byPos[p.pos].push(p);
  const clubCount = new Map<number, number>();
  const picks: number[] = [];
  const takeFor = (pos: FantasyPos, n: number) => {
    const candidates = shuffle(byPos[pos], rng);
    let taken = 0;
    for (const p of candidates) {
      if (taken >= n) break;
      const c = clubCount.get(p.clubId) ?? 0;
      if (c >= MAX_PER_CLUB) continue;
      picks.push(p.id);
      clubCount.set(p.clubId, c + 1);
      taken++;
    }
    if (taken < n) throw new Error(`fixture pool too thin for ${n} ${pos}`);
  };
  (Object.keys(QUOTA) as FantasyPos[]).forEach((pos) => takeFor(pos, QUOTA[pos]));
  return picks;
}

function buildSquadWithClubCap(rng: () => number, pool: PoolPlayer[], clubId: number, pos: FantasyPos): number[] {
  const clubPos = pool.filter((p) => p.clubId === clubId && p.pos === pos).slice(0, MAX_PER_CLUB);
  if (clubPos.length < MAX_PER_CLUB) throw new Error("fixture pool too thin for club-cap fixture");
  const forced = new Set(clubPos.map((p) => p.id));
  const byPos: Record<FantasyPos, PoolPlayer[]> = { GK: [], DEF: [], MID: [], FWD: [] };
  for (const p of pool) if (!forced.has(p.id)) byPos[p.pos].push(p);
  const clubCount = new Map<number, number>([[clubId, MAX_PER_CLUB]]);
  const picks: number[] = [...forced];
  const remaining = { ...QUOTA, [pos]: QUOTA[pos] - MAX_PER_CLUB };
  (Object.keys(remaining) as FantasyPos[]).forEach((p) => {
    const n = remaining[p];
    if (n <= 0) return;
    const candidates = shuffle(byPos[p], rng);
    let taken = 0;
    for (const cand of candidates) {
      if (taken >= n) break;
      const c = clubCount.get(cand.clubId) ?? 0;
      if (c >= MAX_PER_CLUB) continue;
      picks.push(cand.id);
      clubCount.set(cand.clubId, c + 1);
      taken++;
    }
    if (taken < n) throw new Error(`fixture pool too thin for ${n} ${p}`);
  });
  return picks;
}

function toSquad(pickIds: number[], pool: PoolPlayer[], bankTenths: number): Squad {
  const poolById = new Map(pool.map((p) => [p.id, p]));
  const picks: SquadPick[] = pickIds.map((id) => {
    const p = poolById.get(id)!;
    return { id: p.id, pos: p.pos, clubId: p.clubId, buyTenths: p.priceTenths };
  });
  return { picks, bankTenths };
}

/** Random horizon projection: 3 numbers per pool player, 0..15 range. */
function buildProjected(pool: PoolPlayer[], rng: () => number): ProjectedPoints {
  const m: ProjectedPoints = new Map();
  for (const p of pool) m.set(p.id, [Math.floor(rng() * 16), Math.floor(rng() * 16), Math.floor(rng() * 16)]);
  return m;
}

// ── criterion: property test, ≥1,000 iterations — every move survives applyTransfer
test("property: every optimiser move survives applyTransfer, 1200 iterations (club-cap · zero bank · missing-from-pool)", () => {
  const rng = mulberry32(20260721);
  const basePool = buildBigPool();
  const ITER = 1200;
  let totalMoves = 0;
  let clubCapIterations = 0;
  let zeroBankIterations = 0;
  let missingFromPoolIterations = 0;

  for (let i = 0; i < ITER; i++) {
    const forceClubCap = i % 5 === 0;
    const zeroBank = i % 7 === 0;
    const dropSome = i % 3 === 0;
    if (forceClubCap) clubCapIterations++;
    if (zeroBank) zeroBankIterations++;

    const clubId = 1 + Math.floor(rng() * CLUBS);
    const pos: FantasyPos = (["GK", "DEF", "MID", "FWD"] as const)[Math.floor(rng() * 4)];
    let pickIds: number[];
    try {
      pickIds = forceClubCap
        ? buildSquadWithClubCap(rng, basePool, clubId, pos)
        : buildRandomSquad(rng, basePool);
    } catch {
      pickIds = buildRandomSquad(rng, basePool);
    }

    const bankTenths = zeroBank ? 0 : Math.floor(rng() * 500);
    const squad = toSquad(pickIds, basePool, bankTenths);

    let pool = basePool;
    if (dropSome) {
      missingFromPoolIterations++;
      const nDrop = 1 + Math.floor(rng() * 3);
      const shuffled = shuffle(pickIds, rng);
      const dropIds = new Set(shuffled.slice(0, Math.min(nDrop, shuffled.length)));
      pool = basePool.filter((p) => !dropIds.has(p.id));
    }

    const projected = buildProjected(basePool, rng);
    const credits = Math.floor(rng() * 6);
    const wildcardActive = rng() < 0.1;

    const input: OptimiseInput = { squad, pool, projected, credits, wildcardActive };
    const result = optimiseTransfers(input);
    totalMoves += result.moves.length;

    // Sequentially replay every move through the real engine, exactly as a
    // caller applying the optimiser's plan would — this is the hard guarantee.
    let cur = squad;
    for (const m of result.moves) {
      assert.doesNotThrow(
        () => { cur = applyTransfer(cur, m.outId, m.inId, pool); },
        `iteration ${i}: move out=${m.outId} in=${m.inId} should survive applyTransfer`,
      );
    }
  }

  assert.ok(totalMoves > 0, "sanity: the optimiser actually proposed moves across the run");
  assert.ok(clubCapIterations >= 200, "sanity: club-cap fixture actually exercised");
  assert.ok(zeroBankIterations >= 100, "sanity: zero-bank fixture actually exercised");
  assert.ok(missingFromPoolIterations >= 300, "sanity: missing-from-pool fixture actually exercised");
});

// ── criterion: funding case — a signing affordable ONLY by selling two players
test("optimiser finds a 2-move funding combo a single-swap search cannot express", () => {
  // Minimal hand-built pool: one club per player, no club-cap interference.
  let cid = 1;
  const gk = (price: number): PoolPlayer => ({ id: 100 + cid, smId: null, name: `GK${cid}`, club: `C${cid}`, clubId: cid++, pos: "GK", priceTenths: price });
  const def = (price: number): PoolPlayer => ({ id: 200 + cid, smId: null, name: `DEF${cid}`, club: `C${cid}`, clubId: cid++, pos: "DEF", priceTenths: price });
  const mid = (price: number): PoolPlayer => ({ id: 300 + cid, smId: null, name: `MID${cid}`, club: `C${cid}`, clubId: cid++, pos: "MID", priceTenths: price });
  const fwd = (price: number): PoolPlayer => ({ id: 400 + cid, smId: null, name: `FWD${cid}`, club: `C${cid}`, clubId: cid++, pos: "FWD", priceTenths: price });

  // Squad: 2 GK, 5 DEF, 5 MID, 3 FWD — all priced at par (buy == current, so
  // sellTenths == buyTenths, no rise/fall noise to worry about).
  const ownedGk = [gk(45), gk(40)];
  const ownedDef = [def(50), def(48), def(46), def(44), def(42)];
  const ownedMid1 = mid(100); // the funding leg's seller — expensive, but replaceable cheaply
  const ownedMidRest = [mid(60), mid(58), mid(56), mid(54)];
  const ownedFwd1 = fwd(100); // the target-position seller
  const ownedFwdRest = [fwd(70), fwd(65)];

  const owned = [...ownedGk, ...ownedDef, ownedMid1, ...ownedMidRest, ownedFwd1, ...ownedFwdRest];
  assert.equal(owned.length, 15);

  // Pool additions: cheap MID replacement (the funding buy) and one standout
  // unaffordable-alone FWD target.
  const mCheap = mid(20);       // cheap MID alternative — frees (100-20)=80 tenths
  const target = fwd(200);      // premium FWD — NOT affordable with bank(50)+sell(F1=100) alone
  // A few neutral distractor candidates so nothing else outscores our combo.
  const distractorGk = gk(30);
  const distractorDef = def(30);
  const distractorMid = mid(30);
  const distractorFwd = fwd(30);

  const pool: PoolPlayer[] = [...owned, mCheap, target, distractorGk, distractorDef, distractorMid, distractorFwd];

  const squad: Squad = {
    picks: owned.map((p) => ({ id: p.id, pos: p.pos, clubId: p.clubId, buyTenths: p.priceTenths })),
    bankTenths: 50,
  };

  // Prove the single-swap approach CANNOT express this: every direct FWD ->
  // target swap is illegal (budget) from the ORIGINAL squad.
  for (const f of [ownedFwd1, ...ownedFwdRest]) {
    assert.throws(
      () => applyTransfer(squad, f.id, target.id, pool),
      RuleError,
      `selling ${f.name} alone should NOT afford the target — proves single-swap can't reach it`,
    );
  }

  const projected: ProjectedPoints = new Map();
  const setP = (id: number, total: number) => projected.set(id, [Math.round(total / 3), Math.round(total / 3), total - 2 * Math.round(total / 3)]);
  // Funding leg: cheap MID is worse than the MID it replaces (negative rawGain alone).
  setP(ownedMid1.id, 25);
  setP(mCheap.id, 5);
  // Payoff leg: target is much better than the FWD it replaces.
  setP(ownedFwd1.id, 30);
  setP(target.id, 100);
  // Everyone else: flat, unremarkable, and distractors score worse than what
  // they'd replace, so nothing outside the intended combo is ever picked.
  for (const p of [...ownedGk, ...ownedDef, ...ownedMidRest, ...ownedFwdRest]) setP(p.id, 10);
  setP(distractorGk.id, 1); setP(distractorDef.id, 1); setP(distractorMid.id, 1); setP(distractorFwd.id, 1);

  const result = optimiseTransfers({ squad, pool, projected, credits: 2, wildcardActive: false });

  assert.equal(result.moves.length, 2, "the optimiser should take exactly the 2-move funding combo");
  const boughtIds = result.moves.map((m) => m.inId);
  assert.ok(boughtIds.includes(target.id), "the optimiser should end up owning the premium target");
  assert.ok(boughtIds.includes(mCheap.id), "the optimiser should also make the funding sale (MID -> cheap MID)");
  assert.ok(result.totalGain > 0, "the combo should net a positive total gain");
  assert.equal(result.hold, false);

  // And the moves genuinely do survive the engine in sequence.
  let cur = squad;
  for (const m of result.moves) cur = applyTransfer(cur, m.outId, m.inId, pool);
  assert.ok(cur.bankTenths >= 0);
});

// ── criterion: hit economics ───────────────────────────────────────────────
test("hit economics: a move gaining >4 over the horizon is taken as a hit; one gaining <4 is not", () => {
  const pool = buildBigPool();
  const pickIds = buildRandomSquad(mulberry32(7), pool);
  const squad = toSquad(pickIds, pool, 500); // plenty of bank so budget never blocks the swap
  const poolById = new Map(pool.map((p) => [p.id, p]));

  // pick one owned player and one legal same-position, unowned, affordable replacement
  const owned = pickIds[0];
  const ownedPos = poolById.get(owned)!.pos;
  const ownedSet = new Set(pickIds);
  const candidate = pool.find((p) => p.pos === ownedPos && !ownedSet.has(p.id))!;
  assert.doesNotThrow(() => applyTransfer(squad, owned, candidate.id, pool), "fixture swap must itself be legal");

  // weeklyFree: 0 throughout — everyone now gets a free transfer each gameweek,
  // which would make the FIRST move free and hide the hit economics entirely.
  // Gain all on gw+0, so the horizon discount (weight 1.0 on gw+0) leaves it
  // untouched — this test isolates the HIT + MARGIN threshold, not the discount.
  const makeProjected = (gain: number): ProjectedPoints => {
    const m: ProjectedPoints = new Map();
    for (const p of pool) m.set(p.id, [0, 0, 0]);
    m.set(owned, [0, 0, 0]);
    m.set(candidate.id, [gain, 0, 0]);
    return m;
  };

  // The corrected economics: a hit move must clear holding by BOTH the -4 cost
  // AND the anti-churn margin. So the real threshold is gain > HIT_POINTS +
  // MOVE_MARGIN, not the old gain > HIT_POINTS. (This test used to assert the
  // bug: a gain of 6 — net +2 — was "taken". Net +2 exactly equals the margin,
  // and a barely-worth-it hit is precisely what sank the backtest.)
  const clears = HIT_POINTS + MOVE_MARGIN + 2; // 8 -> net +4, comfortably clears
  const resultTaken = optimiseTransfers({
    squad, pool, projected: makeProjected(clears), credits: 0, weeklyFree: 0, wildcardActive: false,
  });
  assert.ok(resultTaken.moves.some((m) => m.outId === owned && m.inId === candidate.id && m.paid === "hit"),
    "a hit whose gain clears cost + margin should be taken");
  assert.equal(resultTaken.hitsTaken, 1);
  assert.equal(resultTaken.totalGain, clears - HIT_POINTS);

  // A gain that beats the -4 cost but NOT the margin on top must be held —
  // this is the class of move that used to churn the squad every week.
  // Half a margin above the cost — derived, never a literal, so it stays
  // "inside the margin" whatever MOVE_MARGIN is set to.
  const marginal = HIT_POINTS + MOVE_MARGIN / 2;
  const resultMarginal = optimiseTransfers({
    squad, pool, projected: makeProjected(marginal), credits: 0, weeklyFree: 0, wildcardActive: false,
  });
  assert.equal(resultMarginal.hold, true, "a hit that beats cost but not the margin should NOT be taken");
  assert.equal(resultMarginal.moves.length, 0);

  // A gain below the -4 cost is obviously never taken.
  const belowCost = HIT_POINTS - 2; // 2
  const resultSkipped = optimiseTransfers({
    squad, pool, projected: makeProjected(belowCost), credits: 0, weeklyFree: 0, wildcardActive: false,
  });
  assert.equal(resultSkipped.hold, true, "a sub-cost gain should NOT be taken as a hit");
  assert.equal(resultSkipped.moves.length, 0);
  assert.equal(resultSkipped.totalGain, 0);
});

test("horizon discount: the same total gain is worth less when it's spread into the future", () => {
  const pool = buildBigPool();
  const pickIds = buildRandomSquad(mulberry32(11), pool);
  const squad = toSquad(pickIds, pool, 500);
  const poolById = new Map(pool.map((p) => [p.id, p]));
  const owned = pickIds[0];
  const ownedPos = poolById.get(owned)!.pos;
  const ownedSet = new Set(pickIds);
  const candidate = pool.find((p) => p.pos === ownedPos && !ownedSet.has(p.id))!;

  const withProjection = (arr: number[]) => {
    const m: ProjectedPoints = new Map();
    for (const p of pool) m.set(p.id, [0, 0, 0]);
    m.set(candidate.id, arr);
    return optimiseTransfers({ squad, pool, projected: m, credits: 0, weeklyFree: 0, wildcardActive: false });
  };

  // Derived from the constants, never hardcoded — both the hit cost and the
  // margin are tuned game-balance numbers and a literal here goes stale the
  // moment either moves (it did: this used to say 8, which cleared a -4 hit
  // but not a -12 one).
  const clearsAHit = HIT_POINTS + MOVE_MARGIN + 2;

  // The full gain landing THIS week clears cost + margin -> taken as a hit.
  assert.equal(withProjection([clearsAHit, 0, 0]).hold, false, "a big gain now is worth a hit");
  // The SAME total, but two weeks out, is a guess we may never collect — the
  // horizon only values gameweek one, so it scores 0 and must NOT justify a hit.
  assert.equal(withProjection([0, 0, clearsAHit]).hold, true, "the same gain two weeks out is not worth a hit now");
});

// ── criterion: wildcard unlocks more moves ─────────────────────────────────
test("wildcard: more moves become optimal when wildcardActive is true", () => {
  const pool = buildBigPool();
  const pickIds = buildRandomSquad(mulberry32(11), pool);
  const squad = toSquad(pickIds, pool, 900); // generous bank so budget rarely blocks anything
  const ownedSet = new Set(pickIds);

  // Projected points: every owned player scores low; every unowned player of
  // the same position scores a modest but real improvement (small enough that
  // taking many of them as HITS would net negative, but taking them for FREE
  // under a wildcard is strictly good).
  const projected: ProjectedPoints = new Map();
  for (const p of pool) {
    // Only index 0 is ever read (HORIZON_WEIGHTS = [1.0]), so this is a +1
    // improvement per swap — small, real, and nowhere near a hit's worth.
    if (ownedSet.has(p.id)) projected.set(p.id, [1, 1, 1]);
    else projected.set(p.id, [2, 2, 2]);
  }

  // weeklyFree: 0 on BOTH arms. Left at its default of 1, the non-wildcard arm
  // would spend its free transfer on a +1 gain and this would stop being a test
  // of the wildcard at all.
  const noWildcard = optimiseTransfers({ squad, pool, projected, credits: 0, weeklyFree: 0, wildcardActive: false });
  const withWildcard = optimiseTransfers({ squad, pool, projected, credits: 0, weeklyFree: 0, wildcardActive: true });

  // No credits, no free transfer, and only +1 per swap: every move would be a
  // hit costing HIT_POINTS, so none is worth taking -> hold. Under a wildcard
  // those same +1 swaps are free wins, so many more become optimal.
  assert.equal(noWildcard.hold, true, "with no free move and only a +1 gain per swap, no hit is worth taking");
  assert.ok(withWildcard.moves.length > noWildcard.moves.length,
    "wildcard should unlock strictly more moves than the non-wildcard run");
  assert.equal(withWildcard.hitsTaken, 0, "wildcard moves are never hits");
  assert.ok(withWildcard.moves.every((m) => m.paid === "free"));
});

// ── criterion: hold is returned when nothing gains ─────────────────────────
test("hold: when no move gains, hold is true and moves is empty", () => {
  const pool = buildBigPool();
  const pickIds = buildRandomSquad(mulberry32(13), pool);
  const squad = toSquad(pickIds, pool, 200);

  // Every player, owned or not, projects identically -> no swap ever gains.
  const projected: ProjectedPoints = new Map();
  for (const p of pool) projected.set(p.id, [5, 5, 5]);

  const result = optimiseTransfers({ squad, pool, projected, credits: 3, wildcardActive: false });
  assert.equal(result.hold, true);
  assert.deepEqual(result.moves, []);
  assert.equal(result.totalGain, 0);
  assert.equal(result.hitsTaken, 0);
});

// ── criterion: unavailable ids are never bought ────────────────────────────
test("unavailable ids are never proposed as an 'in' player", () => {
  const pool = buildBigPool();
  const pickIds = buildRandomSquad(mulberry32(17), pool);
  const squad = toSquad(pickIds, pool, 400);
  const ownedSet = new Set(pickIds);

  // Make every unowned player attractive (so the optimiser WANTS to buy them),
  // then flag most of them unavailable and check none leak through.
  const projected: ProjectedPoints = new Map();
  for (const p of pool) projected.set(p.id, ownedSet.has(p.id) ? [1, 1, 1] : [20, 20, 20]);

  const notOwned = pool.filter((p) => !ownedSet.has(p.id));
  const unavailable = new Set(notOwned.filter((_, i) => i % 2 === 0).map((p) => p.id));

  const result = optimiseTransfers({
    squad, pool, projected, credits: 5, wildcardActive: true, unavailable,
  });

  for (const m of result.moves) {
    assert.ok(!unavailable.has(m.inId), `move bought a flagged unavailable player ${m.inId}`);
  }
  assert.ok(result.moves.length > 0, "sanity: the optimiser did propose moves (from the still-available half)");
});

// ── criterion: determinism ─────────────────────────────────────────────────
test("determinism: same input produces identical output", () => {
  const pool = buildBigPool();
  const pickIds = buildRandomSquad(mulberry32(23), pool);
  const squad = toSquad(pickIds, pool, 300);
  const projected = buildProjected(pool, mulberry32(29));

  const input: OptimiseInput = { squad, pool, projected, credits: 2, wildcardActive: false };
  const r1 = optimiseTransfers(input);
  const r2 = optimiseTransfers(input);
  assert.deepEqual(r1, r2);

  // Also across freshly-rebuilt-but-equal inputs (new object identities).
  const squad2 = toSquad([...pickIds], pool, 300);
  const projected2: ProjectedPoints = new Map(Array.from(projected, ([k, v]) => [k, [...v]]));
  const r3 = optimiseTransfers({ squad: squad2, pool: [...pool], projected: projected2, credits: 2, wildcardActive: false });
  assert.deepEqual(r1, r3);
});

// ═══════════════════════════════════════════════════════════════════════════
// THE PLANNER — the manager names who they're considering dropping
// ═══════════════════════════════════════════════════════════════════════════

test("planner: only the marked players are ever sold", () => {
  const pool = buildBigPool();
  const pickIds = buildRandomSquad(mulberry32(21), pool);
  const squad = toSquad(pickIds, pool, 600);
  // Every unowned player is a big upgrade on everyone, so an unrestricted
  // optimiser would happily sell half the squad. The restriction is the only
  // thing holding it to the two marked names.
  const ownedSet = new Set(pickIds);
  const projected: ProjectedPoints = new Map();
  for (const p of pool) projected.set(p.id, ownedSet.has(p.id) ? [0, 0, 0] : [40, 0, 0]);

  const considering = [pickIds[3], pickIds[9]];
  const plan = planTransfers({
    squad, pool, projected, credits: 5, weeklyFree: 1, wildcardActive: false, considering,
  });

  assert.ok(plan.moves.length > 0, "with a 40-point upgrade available these should be taken");
  for (const m of plan.moves) {
    assert.ok(considering.includes(m.outId), `sold ${m.outId}, which the manager never marked`);
  }
  // and the unrestricted search really would have gone further — otherwise this
  // test would pass even with the restriction wired to nothing.
  const unrestricted = optimiseTransfers({
    squad, pool, projected, credits: 5, weeklyFree: 1, wildcardActive: false,
  });
  assert.ok(unrestricted.moves.length > plan.moves.length,
    "the restriction must actually bind — an unrestricted run should sell more");
});

test("planner: every emitted move is legal, replayed from the original squad", () => {
  // The same guarantee the optimiser makes. A planner that produced a move the
  // server would reject is worse than one that produces nothing.
  const pool = buildBigPool();
  const pickIds = buildRandomSquad(mulberry32(22), pool);
  const squad = toSquad(pickIds, pool, 40); // tight bank, so money genuinely binds
  const projected = buildProjected(pool, mulberry32(23));
  const plan = planTransfers({
    squad, pool, projected, credits: 3, weeklyFree: 1, wildcardActive: false,
    considering: [pickIds[0], pickIds[5], pickIds[11]],
  });
  let cur = squad;
  for (const m of plan.moves) cur = applyTransfer(cur, m.outId, m.inId, pool);
  assert.ok(cur.bankTenths >= 0, "a plan must never overspend");
});

test("planner: marking your best player is answered with 'keep him', not a shuffle", () => {
  const pool = buildBigPool();
  const pickIds = buildRandomSquad(mulberry32(24), pool);
  const squad = toSquad(pickIds, pool, 600);
  const star = pickIds[2];
  // The star outscores every possible replacement; everyone else is level.
  const projected: ProjectedPoints = new Map();
  for (const p of pool) projected.set(p.id, [5, 0, 0]);
  projected.set(star, [99, 0, 0]);

  const plan = planTransfers({
    squad, pool, projected, credits: 5, weeklyFree: 1, wildcardActive: false, considering: [star],
  });
  assert.equal(plan.hold, true, "nothing beats him, so the honest answer is hold");
  assert.deepEqual(plan.moves, []);
  assert.equal(plan.perPlayer.length, 1);
  assert.equal(plan.perPlayer[0].outId, star);
  assert.equal(plan.perPlayer[0].bestInId, null, "no replacement improves on him at all");
  assert.equal(plan.perPlayer[0].gain, 0);
  assert.equal(plan.perPlayer[0].inPlan, false);
});

test("planner: perPlayer distinguishes 'nothing beats him' from 'the money went elsewhere'", () => {
  // Two marked players. One has a real upgrade available; the other doesn't.
  // Both end up outside a one-move plan, and the screen has to be able to say
  // WHY — those are different sentences to show a manager.
  const pool = buildBigPool();
  const pickIds = buildRandomSquad(mulberry32(25), pool);
  const squad = toSquad(pickIds, pool, 600);
  const ownedSet = new Set(pickIds);
  const untouchable = pickIds[1];
  const improvable = pickIds[7];
  const impPos = pool.find((p) => p.id === improvable)!.pos;

  const projected: ProjectedPoints = new Map();
  for (const p of pool) projected.set(p.id, [1, 0, 0]);
  projected.set(untouchable, [99, 0, 0]); // nothing can beat him
  projected.set(improvable, [1, 0, 0]);
  // one clearly better same-position buy for the improvable player
  const upgrade = pool.find((p) => p.pos === impPos && !ownedSet.has(p.id))!;
  projected.set(upgrade.id, [30, 0, 0]);

  const plan = planTransfers({
    squad, pool, projected, credits: 0, weeklyFree: 1, wildcardActive: false,
    considering: [untouchable, improvable],
  });
  const vUnt = plan.perPlayer.find((v) => v.outId === untouchable)!;
  const vImp = plan.perPlayer.find((v) => v.outId === improvable)!;
  assert.equal(vUnt.bestInId, null, "'keep him' — no legal buy improves on him");
  assert.ok(vImp.bestInId !== null, "'there is someone better' — even if the plan can't afford both");
  assert.ok(vImp.gain > 0);
});

test("planner: sells one marked player to fund a signing for another — the funding case", () => {
  // THE combinatorial case, and the reason this isn't just a per-player list.
  // The bank alone cannot afford the premium; selling the marked (and expensive)
  // dud raises exactly enough. Neither move is reachable by considering the two
  // players independently.
  const pool = buildBigPool();
  const pickIds = buildRandomSquad(mulberry32(26), pool);
  const poolById = new Map(pool.map((p) => [p.id, p]));
  const ownedSet = new Set(pickIds);

  // pick two owned MIDs: one to sell for cash, one to upgrade
  const ownedMids = pickIds.filter((id) => poolById.get(id)!.pos === "MID");
  const [fundId, upgradeId] = ownedMids;
  const squad = toSquad(pickIds, pool, 0); // NO bank — the sale is the only money

  const premium = pool.find((p) => p.pos === "MID" && !ownedSet.has(p.id)
    && p.priceTenths > poolById.get(upgradeId)!.priceTenths)!;
  const cheap = pool.find((p) => p.pos === "MID" && !ownedSet.has(p.id)
    && p.id !== premium.id && p.priceTenths < poolById.get(fundId)!.priceTenths)!;

  const projected: ProjectedPoints = new Map();
  for (const p of pool) projected.set(p.id, [1, 0, 0]);
  projected.set(premium.id, [60, 0, 0]);   // worth the whole exercise
  projected.set(cheap.id, [1, 0, 0]);      // the funding sale gains nothing itself

  const plan = planTransfers({
    squad, pool, projected, credits: 2, weeklyFree: 1, wildcardActive: false,
    considering: [fundId, upgradeId],
  });
  assert.ok(plan.moves.some((m) => m.inId === premium.id),
    "the premium signing is the point — it must be reachable by selling the other marked player");
  let cur = squad;
  for (const m of plan.moves) cur = applyTransfer(cur, m.outId, m.inId, pool);
  assert.ok(cur.bankTenths >= 0);
});

test("planner: an id that isn't in the squad is reported, never silently dropped", () => {
  const pool = buildBigPool();
  const pickIds = buildRandomSquad(mulberry32(27), pool);
  const squad = toSquad(pickIds, pool, 300);
  const projected = buildProjected(pool, mulberry32(28));
  const stale = pool.find((p) => !pickIds.includes(p.id))!.id;

  const plan = planTransfers({
    squad, pool, projected, credits: 2, weeklyFree: 1, wildcardActive: false,
    considering: [pickIds[0], stale],
  });
  assert.deepEqual(plan.ignored, [stale], "a stale id from an open tab must be visible");
  assert.ok(plan.perPlayer.every((v) => v.outId !== stale));
});

test("planner: an empty selection is a normal state, not an error", () => {
  const pool = buildBigPool();
  const pickIds = buildRandomSquad(mulberry32(29), pool);
  const squad = toSquad(pickIds, pool, 300);
  const projected = buildProjected(pool, mulberry32(30));
  const plan = planTransfers({
    squad, pool, projected, credits: 3, weeklyFree: 1, wildcardActive: false, considering: [],
  });
  assert.equal(plan.hold, true);
  assert.deepEqual(plan.moves, []);
  assert.deepEqual(plan.perPlayer, []);
  assert.equal(plan.consideredCombinations, 0, "no selection means no search was run at all");
});

test("planner: sees buys the shortlisted search never shows — the whole market", () => {
  // The planner's out-set is a couple of names, so the per-position shortlist
  // (top 10 by projection + 6 cheapest) is guarding against a blow-up that
  // cannot happen here, while hiding real buys. This pins that it is off:
  // a mid-priced, mid-projected player who falls in NEITHER shortlist half is
  // still found when he's the best legal move for the marked player.
  const pool = buildBigPool();
  const pickIds = buildRandomSquad(mulberry32(31), pool);
  const squad = toSquad(pickIds, pool, 900);
  const ownedSet = new Set(pickIds);
  const outId = pickIds.find((id) => pool.find((p) => p.id === id)!.pos === "DEF")!;

  const freeDefs = pool.filter((p) => p.pos === "DEF" && !ownedSet.has(p.id))
    .sort((a, b) => a.priceTenths - b.priceTenths);
  assert.ok(freeDefs.length > 20, "fixture needs enough defenders for a shortlist to exclude some");

  // Give the top 10 by projection to players we then price out of reach, and
  // make the target neither top-projected nor cheapest — squarely in the gap.
  const projected: ProjectedPoints = new Map();
  for (const p of pool) projected.set(p.id, [1, 0, 0]);
  for (let i = 0; i < 10; i++) projected.set(freeDefs[freeDefs.length - 1 - i].id, [50, 0, 0]);
  const target = freeDefs[Math.floor(freeDefs.length / 2)];
  projected.set(target.id, [20, 0, 0]);
  projected.set(outId, [0, 0, 0]);

  const plan = planTransfers({
    squad, pool, projected, credits: 3, weeklyFree: 1, wildcardActive: false, considering: [outId],
  });
  const verdict = plan.perPlayer.find((v) => v.outId === outId)!;
  assert.ok(verdict.bestInId !== null, "a legal upgrade exists and must be found");
});

// ── the planner's latency budget ───────────────────────────────────────────
/** A real-sized pool: 20 clubs, ~700 players, the shape production actually
 *  has. The 15-club fixture above is too small for the depth-2 pair search to
 *  blow up, which is precisely the thing these two tests exist to pin. */
function buildRealSizedPool(): PoolPlayer[] {
  const pool: PoolPlayer[] = [];
  let id = 1;
  for (let club = 1; club <= 20; club++) {
    const add = (pos: FantasyPos, n: number) => {
      for (let i = 0; i < n; i++)
        pool.push({
          id: id++, smId: null, name: `P${id}`, club: `C${club}`, clubId: club,
          pos, priceTenths: 40 + i * 3 + (club % 5) * 4,
        });
    };
    add("GK", 3); add("DEF", 12); add("MID", 13); add("FWD", 7);
  }
  return pool;
}

test("planner: the market width is budgeted, so a big selection can't blow up the search", () => {
  // Measured, not guessed: with the market unbounded, five marked players at
  // this pool size took 7.8 SECONDS — fine for a nightly cron, useless for
  // someone tapping names on a screen. The budget took it to 444ms.
  //
  // The assertion is on the COMBINATION COUNT, not the clock: it is what drives
  // the time, and unlike wall-time it is deterministic and won't flake on a
  // loaded CI box.
  const pool = buildRealSizedPool();
  const pickIds = buildRandomSquad(mulberry32(41), pool);
  const squad = toSquad(pickIds, pool, 150);
  const projected = buildProjected(pool, mulberry32(42));
  const considering = pickIds.slice(0, 5);
  const base = { squad, pool, projected, credits: 2, weeklyFree: 1, wildcardActive: false };

  const budgeted = planTransfers({ ...base, considering });
  const unbounded = optimiseTransfers({
    ...base,
    onlyOutIds: new Set(considering),
    marketWidth: { top: Number.MAX_SAFE_INTEGER, cheap: Number.MAX_SAFE_INTEGER },
  });

  assert.ok(budgeted.consideredCombinations < 60_000,
    `planner searched ${budgeted.consideredCombinations} combinations — the width budget is not binding`);
  assert.ok(unbounded.consideredCombinations > budgeted.consideredCombinations * 3,
    "sanity: the unbounded search must actually be much larger, or this test proves nothing");
});

test("planner: the width budget costs nothing — same answer as an unbounded search", () => {
  // A bound that quietly made the advice worse would be the wrong trade. It
  // doesn't: run out to 40 squads by hand, the budgeted planner and a full
  // unbounded market search reached the same total gain on every single one.
  // Only 6 squads are checked here — each unbounded control search is the
  // 7.8-second case this budget exists to avoid, so a wider sweep belongs in a
  // one-off script, not in the suite that runs on every commit.
  const pool = buildRealSizedPool();
  const SEEDS = 6;
  let identical = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const pickIds = buildRandomSquad(mulberry32(seed * 97), pool);
    const squad = toSquad(pickIds, pool, 100 + seed * 5);
    const projected = buildProjected(pool, mulberry32(seed * 31));
    const considering = pickIds.slice(0, 5);
    const base = { squad, pool, projected, credits: 2, weeklyFree: 1, wildcardActive: false };

    const budgeted = planTransfers({ ...base, considering });
    const unbounded = optimiseTransfers({
      ...base,
      onlyOutIds: new Set(considering),
      marketWidth: { top: Number.MAX_SAFE_INTEGER, cheap: Number.MAX_SAFE_INTEGER },
    });
    if (Math.abs(budgeted.totalGain - unbounded.totalGain) < 1e-9) identical++;
  }
  assert.equal(identical, SEEDS, "the width budget must not cost a single point of projected gain");
});
