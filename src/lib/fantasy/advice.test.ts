import { test } from "node:test";
import assert from "node:assert/strict";
import { applyTransfer, MAX_PER_CLUB, FIXTURE_BONUS, type PoolPlayer, type Squad, type SquadPick, type FantasyPos } from "./engine";
import {
  buildCandidates, buildAdvicePayload, scorePool, resolveAvailability, capReached,
  fetchAllPaged, adviceSettled, orderByNeedsCall, likelyNeedsCall, unwrapRead,
  doubtsFromAvailability, flagSquad, buildPlayerProfile,
  type AvailabilityInfo, type FplStatus, type PagedFetchResult,
} from "./advice";
import type { NewsFormRow, NewsClubRun } from "./news";
import { optimiseTransfers, type ProjectedPoints } from "./optimiser";

// ── deterministic PRNG (mulberry32) — reproducible across runs, no seed drift ─
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

// ── fixture pool: 15 clubs × (3 GK, 8 DEF, 8 MID, 5 FWD), varied prices ───────
const CLUBS = 15;
function buildBigPool(): PoolPlayer[] {
  const pool: PoolPlayer[] = [];
  let id = 1;
  for (let club = 1; club <= CLUBS; club++) {
    const base = 40 + (club % 5) * 8; // tenths, some price variety by club
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

/** Random legal squad (club cap respected) — no budget check, since Squad here
 *  is a plain data holder for buildCandidates, not something validateSquad has
 *  to accept. */
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

/** Deliberately force exactly 3 players from ONE club into one position slot
 *  (criterion 1's "3-from-one-club" coverage, and criterion 10's deterministic
 *  case), keeping the rest of the squad randomly legal. */
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

// ── criterion 1: the property test that matters most ─────────────────────────
test("property: every solver move survives applyTransfer, 1200 iterations (club-cap · zero bank · missing-from-pool)", () => {
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
      pickIds = buildRandomSquad(rng, basePool); // fixture pool ran thin for this club/pos combo — fall back
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

    const scores = scorePool(pool, [], []);
    const creditsLeft = Math.floor(rng() * 6);
    const wildcardActive = rng() < 0.1;

    const moves = buildCandidates(squad, pool, scores, null, creditsLeft, wildcardActive, 8);
    totalMoves += moves.length;
    for (const m of moves) {
      assert.doesNotThrow(
        () => applyTransfer(squad, m.out.id, m.in.id, pool),
        `iteration ${i}: move out=${m.out.id} in=${m.in.id} should survive applyTransfer`,
      );
    }
  }

  assert.ok(totalMoves > 0, "sanity: candidates were actually generated across the run");
  assert.ok(clubCapIterations >= 200, "sanity: club-cap fixture actually exercised");
  assert.ok(zeroBankIterations >= 100, "sanity: zero-bank fixture actually exercised");
  assert.ok(missingFromPoolIterations >= 300, "sanity: missing-from-pool fixture actually exercised");
});

// ── criterion 2: payload sellTenths matches sellPrice()/buyTenths fallback ────
test("buildCandidates: out.sellTenths is sellPrice(buy, current), or buyTenths when the seller left the pool", () => {
  const pool = buildBigPool();
  const pickIds = buildRandomSquad(mulberry32(1), pool);
  const squad = toSquad(pickIds, pool, 100);
  const scores = scorePool(pool, [], []);

  // normal case: seller still in the pool, possibly at a moved price
  const moved = pool.map((p) => (p.id === pickIds[0] ? { ...p, priceTenths: p.priceTenths + 10 } : p));
  const movesNormal = buildCandidates(squad, moved, scores, null, 1, false, 999);
  const outMove = movesNormal.find((m) => m.out.id === pickIds[0]);
  if (outMove) {
    const buy = squad.picks.find((p) => p.id === pickIds[0])!.buyTenths;
    const nowPrice = moved.find((p) => p.id === pickIds[0])!.priceTenths;
    const expected = nowPrice <= buy ? nowPrice : buy + Math.floor((nowPrice - buy) / 2);
    assert.equal(outMove.out.sellTenths, expected);
  }

  // missing-from-pool case: seller removed entirely -> sellTenths falls back to buyTenths
  const withoutSeller = pool.filter((p) => p.id !== pickIds[0]);
  const movesMissing = buildCandidates(squad, withoutSeller, scores, null, 1, false, 999);
  const missingOutMove = movesMissing.find((m) => m.out.id === pickIds[0]);
  if (missingOutMove) {
    const buy = squad.picks.find((p) => p.id === pickIds[0])!.buyTenths;
    assert.equal(missingOutMove.out.sellTenths, buy);
  }
});

// ── criterion 5: hard availability filter — i/s/u never proposed as an "in" ───
test("buildCandidates: never proposes an 'in' player marked i, s, or u", () => {
  const pool = buildBigPool();
  const pickIds = buildRandomSquad(mulberry32(2), pool);
  const squad = toSquad(pickIds, pool, 200);
  const scores = scorePool(pool, [], []);

  const owned = new Set(pickIds);
  const notOwned = pool.filter((p) => !owned.has(p.id));
  const flagged = new Map<number, AvailabilityInfo>();
  const statuses: FplStatus[] = ["i", "s", "u"];
  notOwned.slice(0, 30).forEach((p, i) => {
    flagged.set(p.id, { status: statuses[i % 3], chance: 0, news: "flagged for test" });
  });

  const moves = buildCandidates(squad, pool, scores, flagged, 2, false, 999);
  for (const m of moves) {
    const av = flagged.get(m.in.id);
    assert.ok(!av || (av.status !== "i" && av.status !== "s" && av.status !== "u"),
      `move proposed a flagged 'in' player ${m.in.id} with status ${av?.status}`);
  }
});

// ── criterion 6: resolveAvailability season-epoch guard ──────────────────────
test("resolveAvailability: empty rows, wrong season, and matching season", () => {
  assert.equal(resolveAvailability([], "2026/27"), null);

  const wrongSeason = [{ playerId: 1, status: "a" as const, chance: 100, news: "", fplSeason: "2025/26" }];
  assert.equal(resolveAvailability(wrongSeason, "2026/27"), null);

  const matching = [
    { playerId: 1, status: "i" as const, chance: 0, news: "Knee injury", fplSeason: "2026/27" },
    { playerId: 2, status: "a" as const, chance: 100, news: "", fplSeason: "2026/27" },
  ];
  const map = resolveAvailability(matching, "2026/27");
  assert.ok(map);
  assert.deepEqual(map!.get(1), { status: "i", chance: 0, news: "Knee injury" });
  assert.deepEqual(map!.get(2), { status: "a", chance: 100, news: "" });
});

// ── criterion 10: adversarial pass, deterministic — 3-from-one-club ──────────
test("buildCandidates: a squad already at 3-from-one-club proposes no illegal 4th from that club", () => {
  const pool = buildBigPool();
  const clubId = 3;
  const pos: FantasyPos = "DEF";
  const pickIds = buildSquadWithClubCap(mulberry32(3), pool, clubId, pos);
  const squad = toSquad(pickIds, pool, 300);
  const scores = scorePool(pool, [], []);

  const moves = buildCandidates(squad, pool, scores, null, 2, false, 999);
  const poolById = new Map(pool.map((p) => [p.id, p]));
  const outClubOf = new Map(squad.picks.map((p) => [p.id, p.clubId]));

  for (const m of moves) {
    const inClub = poolById.get(m.in.id)?.clubId;
    if (inClub === clubId) {
      // only legal if the OUT player is also from clubId (a like-for-like swap that
      // leaves the club count at exactly 3, never pushing it to 4)
      assert.equal(outClubOf.get(m.out.id), clubId,
        `move brought in a 4th club-${clubId} player without selling one of the existing 3`);
    }
  }
});

// ── criterion 9: the cap guard is a pure, trivially-testable function ────────
test("capReached: pure threshold check", () => {
  assert.equal(capReached(0, 300), false);
  assert.equal(capReached(299, 300), false);
  assert.equal(capReached(300, 300), true);
  assert.equal(capReached(301, 300), true);
});

// sanity: scorePool actually uses form + fixtures, not just a constant
test("scorePool: form points and fixture difficulty both move the score", () => {
  const pool = buildBigPool();
  const form: NewsFormRow[] = [{ playerId: pool[0].id, name: pool[0].name, club: pool[0].club, pos: pool[0].pos, line: "", points: 20 }];
  const runs: NewsClubRun[] = [{
    clubId: pool[0].clubId, club: pool[0].club, short: "ABC",
    cells: [{ gw: 1, opponent: "X", oppShort: "X", home: true, difficulty: "kind" }],
  }];
  const scores = scorePool(pool, form, runs);
  assert.equal(scores.get(pool[0].id), 20 + FIXTURE_BONUS, "form points + kind-fixture bonus");
  // pool[1] is the SAME club as pool[0] (club-mates share a fixture run), so it
  // still gets the kind-fixture bonus despite having no form points of its
  // own — that's correct (moveScore is per-club fixture, per-player form).
  assert.equal(scores.get(pool[1].id), 0 + FIXTURE_BONUS, "club-mate with no form still gets the club's fixture bonus");
  // A player from a DIFFERENT club (no run entry at all) gets neither term.
  const otherClub = pool.find((p) => p.clubId !== pool[0].clubId)!;
  assert.equal(scores.get(otherClub.id), 0, "an unscored, fixture-less player defaults to 0");
});

// ── scale defect S1: fetchAllPaged never silently truncates ──────────────────
/** In-memory fake standing in for a Supabase `.range(from, to)` read — the
 *  real range-based pagination contract: an inclusive [from, to] window over
 *  a fixed backing array, with `count` reported once (as `.select(..., {count:
 *  "exact"})` would on any page, but the caller in route.ts only asks for it on
 *  the first). */
function fakePagedSource<T>(all: T[], countOnFirstPageOnly = true) {
  return async (from: number, to: number): Promise<PagedFetchResult<T>> => ({
    rows: all.slice(from, to + 1),
    count: !countOnFirstPageOnly || from === 0 ? all.length : null,
  });
}

test("fetchAllPaged: a dataset far past PostgREST's 1,000-row default cap is read in full", () => {
  return (async () => {
    const all = Array.from({ length: 3400 }, (_, i) => ({ id: i }));
    const { rows, expectedCount } = await fetchAllPaged(fakePagedSource(all), 1000);
    assert.equal(rows.length, 3400, "every row past the 1,000-row PostgREST default came back");
    assert.equal(expectedCount, 3400);
    assert.deepEqual(rows[0], { id: 0 });
    assert.deepEqual(rows[3399], { id: 3399 });
  })();
});

test("fetchAllPaged: an exact multiple of pageSize still terminates (doesn't loop forever on a full last page)", () => {
  return (async () => {
    const all = Array.from({ length: 6 }, (_, i) => ({ id: i }));
    const { rows } = await fetchAllPaged(fakePagedSource(all), 3);
    assert.equal(rows.length, 6);
  })();
});

test("fetchAllPaged: empty source returns no rows and doesn't throw", () => {
  return (async () => {
    const { rows, expectedCount } = await fetchAllPaged(fakePagedSource<{ id: number }>([]), 1000);
    assert.equal(rows.length, 0);
    assert.equal(expectedCount, 0);
  })();
});

test("fetchAllPaged: expectedCount surfaces a mismatch instead of hiding it — the caller can detect a truncated/racing read", () => {
  return (async () => {
    // Simulates a row disappearing between the first page (which reports
    // count=10) and a later page — the exact scenario a concurrent delete
    // during a long paginated cron read could cause. fetchAllPaged doesn't
    // silently trust the loop; it reports both numbers so the caller can
    // compare and log.
    let call = 0;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature must match fetchPage
    const flaky = async (_from: number, _to: number): Promise<PagedFetchResult<{ id: number }>> => {
      call++;
      if (call === 1) return { rows: [{ id: 0 }, { id: 1 }, { id: 2 }], count: 10 };
      return { rows: [], count: null }; // the rest vanished
    };
    const { rows, expectedCount } = await fetchAllPaged(flaky, 3);
    assert.equal(rows.length, 3, "the loop terminated on the short page, as designed");
    assert.equal(expectedCount, 10, "but the mismatch (3 vs 10) is visible to the caller, not swallowed");
    assert.notEqual(rows.length, expectedCount, "sanity: this IS the mismatch a caller must log");
  })();
});

// ── scale defect S2: resumability — not-yet-generated users go first ─────────
test("adviceSettled: no row, wrong hash, or an unsettled issue all mean 'still needs a call'", () => {
  assert.equal(adviceSettled(null, "abc"), false);
  assert.equal(adviceSettled({ payload_hash: "old", advice: { moves: [] }, issue: null }, "new"), false, "hash mismatch — squad/prices moved since");
  assert.equal(adviceSettled({ payload_hash: "abc", advice: null, issue: "http-500" }, "abc"), false, "a transient failure is worth retrying");
  assert.equal(adviceSettled({ payload_hash: "abc", advice: { moves: [] }, issue: null }, "abc"), true, "matching hash + real advice");
  assert.equal(adviceSettled({ payload_hash: "abc", advice: null, issue: "failed-grounding" }, "abc"), true, "matching hash + a deterministic failure — retrying buys nothing");
  assert.equal(adviceSettled({ payload_hash: "abc", advice: null, issue: "no-candidates" }, "abc"), true, "F9: no-candidates is a deterministic, non-LLM conclusion from the payload itself");
});

// ── defect F8: an absent API key is an OPS condition, never permanently settled ─
test("adviceSettled: F8 — 'no-key' must NEVER count as settled, even with a matching hash", () => {
  assert.equal(
    adviceSettled({ payload_hash: "abc", advice: null, issue: "no-key" }, "abc"), false,
    "an unset ANTHROPIC_API_KEY is transient/ops, not a property of the payload — a row generated while the " +
    "key was unset must keep retrying once the key comes back, not stay null-advice forever just because the " +
    "squad never changed",
  );
});

// ── defect F1: cheap pre-optimiser ordering proxy ────────────────────────────
test("likelyNeedsCall: no cached row at all always needs a call", () => {
  assert.equal(likelyNeedsCall("2026-07-20T00:00:00Z", undefined), true);
  assert.equal(likelyNeedsCall("2026-07-20T00:00:00Z", null), true);
});

test("likelyNeedsCall: a cached 'no-key' issue always needs a call, regardless of timestamps (F8)", () => {
  assert.equal(
    likelyNeedsCall("2020-01-01T00:00:00Z", { generated_at: "2026-07-21T00:00:00Z", issue: "no-key" }),
    true,
    "even though the squad is OLDER than the cached row, a no-key row must still be prioritised for retry",
  );
});

test("likelyNeedsCall: squad updated after the cached row was generated needs a call; updated before does not", () => {
  const cached = { generated_at: "2026-07-21T12:00:00Z", issue: null as string | null };
  assert.equal(likelyNeedsCall("2026-07-21T13:00:00Z", cached), true, "squad changed AFTER the cached advice was generated");
  assert.equal(likelyNeedsCall("2026-07-21T11:00:00Z", cached), false, "squad hasn't changed since — likely still settled");
});

// ── defect F6: DB reads must distinguish a real error from a genuine empty ────
test("unwrapRead: an error always throws, carrying the caller's context", () => {
  assert.throws(
    () => unwrapRead({ data: null, error: { message: "connection reset" } }, "fantasy_player_scores read failed"),
    /fantasy_player_scores read failed: connection reset/,
  );
});

test("unwrapRead: no error returns `.data` as-is, including a legitimate null (e.g. maybeSingle with no row)", () => {
  assert.equal(unwrapRead({ data: null, error: null }, "ctx"), null, "a genuine empty result must NOT throw");
  assert.deepEqual(unwrapRead({ data: [{ id: 1 }], error: null }, "ctx"), [{ id: 1 }]);
});

test("orderByNeedsCall: stable partition — needs-call users first, in original order, settled users last", () => {
  const items = ["a", "b", "c", "d", "e"];
  const needsCall = new Set(["b", "d"]);
  const ordered = orderByNeedsCall(items, (x) => needsCall.has(x));
  assert.deepEqual(ordered, ["b", "d", "a", "c", "e"]);
});

test("orderByNeedsCall: everyone settled or everyone pending is still a no-op reorder", () => {
  assert.deepEqual(orderByNeedsCall([1, 2, 3], () => false), [1, 2, 3]);
  assert.deepEqual(orderByNeedsCall([1, 2, 3], () => true), [1, 2, 3]);
});

// ── scale defect S3: the per-GW cap must hold under concurrent runs ──────────
// `AdviceBudget` below is a pure IN-MEMORY MODEL of the single atomic SQL
// statement `fantasy_reserve_advice_call` performs (supabase/migrations/
// 100_fantasy_advice.sql: `update ... set spent = spent + 1 where spent < p_cap
// returning true`) — it is NOT a substitute for testing the real Postgres
// function, which this harness has no live database to exercise. What IS
// testable without a DB is the ALGORITHM: "check the cap and spend a slot" as
// one indivisible step never over-grants, while the OLD approach this file
// replaced — a separate read (SELECT count(*)) followed by a compare-then-write
// in application code, with an awaited round trip in between — provably does,
// the moment two callers interleave around that gap. This pair of tests proves
// the shape of the fix is sound; the SQL function mirrors it 1:1.
class AdviceBudget {
  private spent = 0;
  constructor(private cap: number) {}
  /** No `await` inside: nothing can observe state between the check and the
   *  increment, which is exactly the guarantee the DB's single UPDATE
   *  statement (and the row lock it holds for its duration) provides. */
  reserve(): boolean {
    if (this.spent >= this.cap) return false;
    this.spent++;
    return true;
  }
  get spentCount(): number { return this.spent; }
}

test("AdviceBudget (models fantasy_reserve_advice_call): the cap holds exactly, even with 1000 'concurrent' reservations racing it", () => {
  return (async () => {
    const budget = new AdviceBudget(300);
    const callers = Array.from({ length: 1000 }, () => async () => {
      await Promise.resolve(); // scheduling jitter around the call — the reservation itself has no gap
      return budget.reserve();
    });
    const results = await Promise.all(callers.map((c) => c()));
    const granted = results.filter(Boolean).length;
    assert.equal(granted, 300, "never more than the cap is granted");
    assert.equal(budget.spentCount, 300);
  })();
});

test("the OLD bug: a separate read-count-then-write DOES exceed the cap under interleaving — this is why S3 needed fixing", () => {
  return (async () => {
    let spent = 0;
    const cap = 300;
    async function racyReserve(): Promise<boolean> {
      const observed = spent; // step 1: read (the old route.ts's SELECT count(*))
      await Promise.resolve(); // step 2: the gap a real DB round trip leaves open
      if (observed >= cap) return false;
      spent = observed + 1; // step 3: write, based on a potentially stale read
      return true;
    }
    const results = await Promise.all(Array.from({ length: 1000 }, () => racyReserve()));
    const granted = results.filter(Boolean).length;
    assert.ok(granted > cap, `sanity: the naive approach overshoots (granted ${granted} against a cap of ${cap}) — proving the fix is load-bearing, not cosmetic`);
  })();
});

// ── buildAdvicePayload's `recommended` field — the optimiser integration ─────
test("buildAdvicePayload: an optimiser result becomes payload.recommended — position, sellTenths, paid, gain", () => {
  const pool = buildBigPool();
  const pickIds = buildRandomSquad(mulberry32(41), pool);
  const squad = toSquad(pickIds, pool, 500);
  const poolById = new Map(pool.map((p) => [p.id, p]));

  const owned = pickIds[0];
  const ownedPos = poolById.get(owned)!.pos;
  const ownedSet = new Set(pickIds);
  const candidatePlayer = pool.find((p) => p.pos === ownedPos && !ownedSet.has(p.id))!;

  const projected: ProjectedPoints = new Map();
  for (const p of pool) projected.set(p.id, [0, 0, 0]);
  projected.set(candidatePlayer.id, [10, 0, 0]); // one clear, unambiguous single-move win

  const optimised = optimiseTransfers({ squad, pool, projected, credits: 1, wildcardActive: false });
  assert.equal(optimised.moves.length, 1, "sanity: exactly the one clear move should be taken");
  assert.equal(optimised.moves[0].outId, owned);
  assert.equal(optimised.moves[0].inId, candidatePlayer.id);

  const scores = scorePool(pool, [], []);
  const payload = buildAdvicePayload({
    gw: 1, bankTenths: squad.bankTenths, credits: 1, chipsHeld: 0, wildcardHeld: 0,
    squad, pool, scores, availability: null, runs: [], candidates: [], optimised,
  });

  assert.equal(payload.recommended.hold, false);
  assert.equal(payload.recommended.degraded, false, "a real optimiser result, whatever it concludes, is never degraded");
  assert.equal(payload.recommended.moves.length, 1);
  const m = payload.recommended.moves[0];
  assert.equal(m.position, 1, "1-based sequence position, not a display rank");
  assert.equal(m.out.id, owned);
  assert.equal(m.out.sellTenths, squad.picks.find((p) => p.id === owned)!.buyTenths, "at par, sellTenths == buyTenths");
  assert.equal(m.in.id, candidatePlayer.id);
  assert.equal(m.in.priceTenths, candidatePlayer.priceTenths);
  // Everyone now gets a free transfer each gameweek, and it is spent BEFORE any
  // credit (it expires and cannot be cashed, so saving it banks nothing). So the
  // FIRST move of a plan is "free", not "credit" — and the payload must copy
  // whatever the optimiser decided rather than re-deriving it.
  assert.equal(m.paid, optimised.moves[0].paid, "payload copies the optimiser's own label");
  assert.equal(m.paid, "free", "first move of the week spends the perishable free transfer");
  assert.equal(m.gain, 10);
  assert.equal(payload.recommended.totalGain, optimised.totalGain);
  assert.equal(payload.recommended.hitsTaken, optimised.hitsTaken);
});

// ── criterion: hold renders as hold, not an absent/broken field ──────────────
test("buildAdvicePayload: an optimiser hold result renders recommended.hold=true with no moves", () => {
  const pool = buildBigPool();
  const pickIds = buildRandomSquad(mulberry32(43), pool);
  const squad = toSquad(pickIds, pool, 200);

  // Every player, owned or not, projects identically -> no swap ever gains ->
  // the optimiser's own documented "hold" case (mirrors optimiser.test.ts).
  const projected: ProjectedPoints = new Map();
  for (const p of pool) projected.set(p.id, [5, 5, 5]);
  const optimised = optimiseTransfers({ squad, pool, projected, credits: 3, wildcardActive: false });
  assert.equal(optimised.hold, true, "sanity: this fixture is the optimiser's own hold case");

  const scores = scorePool(pool, [], []);
  const payload = buildAdvicePayload({
    gw: 1, bankTenths: squad.bankTenths, credits: 3, chipsHeld: 0, wildcardHeld: 0,
    squad, pool, scores, availability: null, runs: [], candidates: [], optimised,
  });
  assert.deepEqual(payload.recommended, { moves: [], totalGain: 0, hitsTaken: 0, hold: true, degraded: false });
});

// ── defect F7: a degraded (optimiser-never-ran) result must be DISTINGUISHABLE
//    from a genuine hold, even though both are hold-shaped ────────────────────
test("buildAdvicePayload: no optimised result (the cron's degrade path) is hold-SHAPED but flagged degraded=true, unlike a genuine hold", () => {
  const pool = buildBigPool();
  const pickIds = buildRandomSquad(mulberry32(47), pool);
  const squad = toSquad(pickIds, pool, 200);
  const scores = scorePool(pool, [], []);

  // No `optimised` passed at all — exactly what the cron route does when the
  // projection layer or optimiseTransfers() itself throws (both are caught and
  // logged there, never left to bubble up into a hard failure).
  const payload = buildAdvicePayload({
    gw: 1, bankTenths: squad.bankTenths, credits: 2, chipsHeld: 0, wildcardHeld: 0,
    squad, pool, scores, availability: null, runs: [], candidates: [],
  });
  assert.deepEqual(
    payload.recommended, { moves: [], totalGain: 0, hitsTaken: 0, hold: true, degraded: true },
    "the NUMBERS still render like a genuine hold (never an empty/broken card), but degraded=true is what lets " +
    "a caller (the transfers page) tell 'the optimiser genuinely found nothing' apart from 'the optimiser never ran'",
  );
});

// ── criterion: a later move's OUT is a player THIS sequence itself bought ────
// buildAdvicePayload only ever CONSUMES an OptimiseResult, it doesn't produce
// one — so the cleanest way to pin down this exact edge case (move 2 sells the
// very player move 1 just bought, not an original squad member) is to hand-
// build a legal 2-move OptimiseResult directly, found via the real engine
// rather than guessed prices. This is a payload/replay test, not a search
// test — optimiser.test.ts already owns proving the SEARCH finds sequences
// like this; this proves buildAdvicePayload REPLAYS one correctly.
test("buildAdvicePayload: a move whose OUT player was bought by an earlier move in the same sequence still gets a correct sellTenths", () => {
  const pool = buildBigPool();
  const pickIds = buildRandomSquad(mulberry32(53), pool);
  const squad = toSquad(pickIds, pool, 500); // generous bank — legality, not budget, is what's under test
  const poolById = new Map(pool.map((p) => [p.id, p]));

  const owned = pickIds[0];
  const ownedPos = poolById.get(owned)!.pos;
  const ownedSet = new Set(pickIds);
  const unownedSamePos = pool.filter((p) => p.pos === ownedPos && !ownedSet.has(p.id));

  const a = unownedSamePos[0];
  const squad1 = applyTransfer(squad, owned, a.id, pool); // move 1: owned -> a
  const b = unownedSamePos.find((cand) => {
    if (cand.id === a.id) return false;
    try { applyTransfer(squad1, a.id, cand.id, pool); return true; } catch { return false; }
  });
  assert.ok(b, "fixture: at least one further same-position swap out of `a` must be legal");

  // Hand-built — never produced by optimiseTransfers itself. `consideredCombinations`
  // is a search-diagnostics field buildAdvicePayload never reads; 0 is fine here.
  const optimised = {
    moves: [
      { outId: owned, inId: a.id, paid: "credit" as const, gain: 5 },
      { outId: a.id, inId: b!.id, paid: "credit" as const, gain: 8 },
    ],
    totalGain: 13, hitsTaken: 0, hold: false, consideredCombinations: 0,
  };

  const scores = scorePool(pool, [], []);
  const payload = buildAdvicePayload({
    gw: 1, bankTenths: squad.bankTenths, credits: 2, chipsHeld: 0, wildcardHeld: 0,
    squad, pool, scores, availability: null, runs: [], candidates: [], optimised,
  });

  assert.equal(payload.recommended.moves.length, 2, "both moves must survive the payload's own replay");
  const [m1, m2] = payload.recommended.moves;
  assert.equal(m1.position, 1);
  assert.equal(m2.position, 2);
  // Move 1 sells an ORIGINAL squad member.
  assert.equal(m1.out.id, owned);
  assert.equal(m1.in.id, a.id);
  // Move 2's OUT is `a` — a player who is NOT in the original squad at all.
  // His sellTenths can only be computed from the squad state AFTER move 1 is
  // replayed (he was just bought at a.priceTenths, so at par he sells for
  // exactly that) — a naive lookup against the ORIGINAL squad would find
  // nothing for him and silently fall back to 0.
  assert.equal(m2.out.id, a.id);
  assert.equal(m2.out.sellTenths, a.priceTenths, "sellTenths must come from replaying move 1, not the original squad");
  assert.equal(m2.in.id, b!.id);
});

// ── doubtsFromAvailability — the replacement for an inference that never fired ─
// Homed here (not news.ts) because news.ts value-imports pool.ts, which drags
// pool.json into anything that requires it at runtime — tsc resolves the "@/*"
// alias for types but does not rewrite the require, so such a test cannot load.
// The function is pure and takes the pool as an argument, so advice.ts is its
// natural home anyway.
const DOUBT_POOL = [
  { id: 1, smId: 900, name: "Cole Palmer", club: "Chelsea" },
  { id: 2, smId: 901, name: "Erling Haaland", club: "Man City" },
  { id: 3, smId: 902, name: "Bukayo Saka", club: "Arsenal" },
  { id: 4, smId: null, name: "No SM Id", club: "Everton" },
];

test("doubtsFromAvailability: an available player is never a doubt", () => {
  assert.deepEqual(
    doubtsFromAvailability([{ playerId: 1, status: "a", chance: 100, news: "" }], DOUBT_POOL),
    [],
  );
});

test("doubtsFromAvailability: FPL's own words are used verbatim as the reason", () => {
  // The point of switching source: this is a CITABLE fact, not an inference,
  // so the grounded tips layer may finally say "injury" honestly.
  const out = doubtsFromAvailability(
    [{ playerId: 1, status: "i", chance: 0, news: "Knee injury - Expected back 01 Apr" }],
    DOUBT_POOL,
  );
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], {
    smId: 900, name: "Cole Palmer", club: "Chelsea", reason: "Knee injury - Expected back 01 Apr",
  });
});

test("doubtsFromAvailability: with no news string, the reason states only what we know", () => {
  const out = doubtsFromAvailability([
    { playerId: 1, status: "s", chance: 0, news: "" },
    { playerId: 2, status: "d", chance: 25, news: "" },
    { playerId: 3, status: "d", chance: null, news: "" },
  ], DOUBT_POOL);
  assert.equal(out.find((d) => d.smId === 900)!.reason, "suspended");
  assert.equal(out.find((d) => d.smId === 901)!.reason, "25% chance of playing");
  assert.equal(out.find((d) => d.smId === 902)!.reason, "a doubt",
    "no percentage given — never say anything more precise than we know");
});

test("doubtsFromAvailability: a player outside the pool, or with no smId, is skipped", () => {
  assert.deepEqual(doubtsFromAvailability([
    { playerId: 99, status: "i", chance: 0, news: "Injured" }, // not in the pool
    { playerId: 4, status: "i", chance: 0, news: "Injured" },  // in pool, smId null
  ], DOUBT_POOL), [], "NewsDoubt is keyed on smId — neither can be rendered");
});

// ═══════════════════════════════════════════════════════════════════════════
// flagSquad — telling a manager one of THEIR players isn't playing
// ═══════════════════════════════════════════════════════════════════════════
function squadOf(ids: number[]): Squad {
  return {
    picks: ids.map((id) => ({ id, pos: "MID" as FantasyPos, clubId: 1, buyTenths: 50 })),
    bankTenths: 0,
  };
}
const av = (status: string, chance: number | null, news = "") =>
  ({ status, chance, news }) as never;

test("flagSquad: injured, suspended and unavailable are all 'out', and high severity", () => {
  const squad = squadOf([1, 2, 3, 4]);
  const availability = new Map([
    [1, av("i", 0, "Knee injury - Expected back 01 Apr")],
    [2, av("s", 0)],
    [3, av("u", null)],
    [4, av("a", 100)],
  ]);
  const flags = flagSquad({ squad, availability });
  assert.equal(flags.length, 3, "the available player is not flagged");
  assert.ok(flags.every((f) => f.kind === "out" && f.severity === "high"));
  // FPL's own words are used when it gives them, never paraphrased away.
  assert.equal(flags.find((f) => f.playerId === 1)!.reason, "Knee injury - Expected back 01 Apr");
  // and a plain phrase when it doesn't — never an invented cause
  assert.equal(flags.find((f) => f.playerId === 2)!.reason, "suspended");
});

test("flagSquad: a doubt at 50% or less is high severity, above that is medium", () => {
  const squad = squadOf([1, 2, 3]);
  const availability = new Map([
    [1, av("d", 25)],
    [2, av("d", 75)],
    [3, av("d", null)],
  ]);
  const flags = flagSquad({ squad, availability });
  const by = new Map(flags.map((f) => [f.playerId, f]));
  assert.equal(by.get(1)!.severity, "high", "more likely to miss than play");
  assert.equal(by.get(2)!.severity, "medium", "worth a look, not a panic");
  assert.equal(by.get(3)!.severity, "medium", "an unexplained doubt is not a crisis");
  assert.equal(by.get(1)!.reason, "25% chance of playing");
});

test("flagSquad: a fit player who has stopped playing is flagged — the case FPL never reports", () => {
  // Nothing wrong with him. He has simply lost his place, which the status feed
  // says nothing about and which costs a manager just as many points.
  const squad = squadOf([1, 2]);
  const recentMinutes = new Map([
    [1, [90, 90, 0, 0]],  // dropped
    [2, [0, 0, 45, 90]],  // came INTO the team — must not be flagged
  ]);
  const flags = flagSquad({ squad, availability: null, recentMinutes });
  assert.equal(flags.length, 1);
  assert.equal(flags[0].playerId, 1);
  assert.equal(flags[0].kind, "benched");
  assert.equal(flags[0].severity, "medium");
});

test("flagSquad: one quiet gameweek is not a flag — the tool must not cry wolf", () => {
  // A single missed game is a rest, a knock, or a cup rotation. Flagging it
  // would fire on half the squad every week and train people to ignore it.
  const squad = squadOf([1]);
  const flags = flagSquad({ squad, availability: null, recentMinutes: new Map([[1, [90, 90, 0]]]) });
  assert.deepEqual(flags, []);
});

test("flagSquad: a player with too little history is never called benched", () => {
  // A new signing has not failed to play — he has not had the chance. Judging
  // him on a sample of one is the same mistake as the season-average
  // denominator: absence of opportunity read as absence of quality.
  const squad = squadOf([1]);
  const flags = flagSquad({ squad, availability: null, recentMinutes: new Map([[1, [0]]]) });
  assert.deepEqual(flags, [], "one gameweek is not a window");
});

test("flagSquad: a status concern outranks the minutes signal for the same player", () => {
  // He's injured AND hasn't played. "Injured" is the useful sentence; saying
  // both would be noise, and the reason a manager can act on is the injury.
  const squad = squadOf([1]);
  const flags = flagSquad({
    squad,
    availability: new Map([[1, av("i", 0, "Hamstring")]]),
    recentMinutes: new Map([[1, [0, 0]]]),
  });
  assert.equal(flags.length, 1);
  assert.equal(flags[0].kind, "out");
  assert.equal(flags[0].reason, "Hamstring");
});

test("flagSquad: the minutes signal still works with NO availability feed at all", () => {
  // Degrade mode is not a rare edge — it is gameweek 1 of a new season, and any
  // week FPL's status read fails. The half we can compute ourselves must survive.
  const squad = squadOf([1, 2]);
  const flags = flagSquad({
    squad, availability: null,
    recentMinutes: new Map([[1, [0, 0]], [2, [90, 90]]]),
  });
  assert.equal(flags.length, 1);
  assert.equal(flags[0].playerId, 1);
});

test("flagSquad: worst first — a manager scanning this hits the definites before the maybes", () => {
  const squad = squadOf([1, 2, 3, 4]);
  const flags = flagSquad({
    squad,
    availability: new Map([[2, av("d", 75)], [3, av("i", 0)], [4, av("d", 25)]]),
    recentMinutes: new Map([[1, [0, 0]]]),
  });
  assert.deepEqual(flags.map((f) => f.playerId), [3, 4, 2, 1],
    "out, then the bad doubt, then the mild doubt, then merely benched");
});

// ═══════════════════════════════════════════════════════════════════════════
// buildPlayerProfile — show what PAYS, and only what pays
// ═══════════════════════════════════════════════════════════════════════════
const F = (o: Partial<Record<string, number>> = {}) => ({
  minutes: 90, goals: 0, assists: 0, cleanSheet: 0, conceded: 0, saves: 0,
  pensSaved: 0, pensMissed: 0, yellows: 0, reds: 0, ownGoals: 0, dc: 0, dcRec: 0, ...o,
}) as never;
const gws = (n: number, facts: unknown, points = 2) =>
  Array.from({ length: n }, (_, i) => ({ gw: i + 1, facts: facts as never, points }));
/** n appearances totalling exactly `goals` — the repeat-helper above multiplies
 *  its facts by n, which is fine for rates but wrong for totals. */
const gwsScoring = (n: number, goals: number) =>
  Array.from({ length: n }, (_, i) => ({
    gw: i + 1, facts: F({ goals: i === 0 ? goals : 0 }), points: 2,
  }));

test("profile: a forward is NEVER shown clean sheets — they pay him nothing", () => {
  const p = buildPlayerProfile({ playerId: 1, pos: "FWD", recent: gws(5, F({ cleanSheet: 1 })) });
  assert.ok(!p.stats.some((s) => /clean sheet/i.test(s.label)),
    "a clean sheet is worth 0 to a forward, so mentioning it is noise");
});

test("profile: a goalkeeper gets saves and NO expected-goals line", () => {
  const p = buildPlayerProfile({
    playerId: 1, pos: "GK", recent: gws(5, F({ saves: 4, cleanSheet: 1 })), xg: 0.2,
  });
  assert.ok(p.stats.some((s) => s.label === "Saves"), "3 saves pay a point — this is his floor");
  assert.ok(!p.stats.some((s) => /expected/i.test(s.label)),
    "keepers do not shoot; an xG line for one is meaningless");
});

test("profile: a defender leads on clean sheets, then defensive returns", () => {
  const p = buildPlayerProfile({ playerId: 1, pos: "DEF", recent: gws(5, F({ dc: 11 })) });
  assert.equal(p.stats[0].label, "Clean sheets", "4 points, the biggest recurring thing he does");
  assert.equal(p.stats[1].label, "Defensive returns", "2 points whether or not the team keeps one");
});

test("profile: a midfielder leads on attack, not clean sheets", () => {
  const p = buildPlayerProfile({ playerId: 1, pos: "MID", recent: gwsScoring(5, 1) });
  assert.equal(p.stats[0].label, "Goals and assists", "a goal pays 5, a clean sheet 1");
});

test("profile: 'getting chances, not taking them' fires only on a clear margin", () => {
  // The whole point of the line: a player on a bad run is either unlucky or
  // finished, and those need opposite decisions.
  const unlucky = buildPlayerProfile({
    playerId: 1, pos: "FWD", recent: gws(5, F()), xg: 5.8,
  });
  const s = unlucky.stats.find((x) => x.label === "Goals vs expected")!;
  assert.equal(s.value, "0 from 5.8 expected");
  assert.equal(s.note, "getting chances, not taking them");

  const hot = buildPlayerProfile({
    playerId: 1, pos: "FWD", recent: gwsScoring(5, 2), xg: 0.4,
  });
  assert.equal(hot.stats.find((x) => x.label === "Goals vs expected")!.note,
    "scoring more than his chances suggest");
});

test("profile: a close call says NOTHING rather than inventing insight", () => {
  // 2 goals from 2.3 expected is a player having a normal time. Any sentence
  // here would be false precision dressed up as analysis.
  const p = buildPlayerProfile({
    playerId: 1, pos: "FWD", recent: gwsScoring(5, 2), xg: 2.3,
  });
  assert.equal(p.stats.find((x) => x.label === "Goals vs expected")!.note, null);
});

test("profile: per-game rate divides by games PLAYED, never gameweeks elapsed", () => {
  // The exact mistake that made season-average ranking wrong. A player who
  // appeared twice in five weeks and scored 20 is a 10-a-game player who has
  // been unavailable, not a 4-a-game player.
  const recent = [
    { gw: 1, facts: F({ minutes: 90 }), points: 10 },
    { gw: 2, facts: F({ minutes: 0 }), points: 0 },
    { gw: 3, facts: F({ minutes: 0 }), points: 0 },
    { gw: 4, facts: F({ minutes: 0 }), points: 0 },
    { gw: 5, facts: F({ minutes: 90 }), points: 10 },
  ];
  const p = buildPlayerProfile({ playerId: 1, pos: "MID", recent });
  assert.equal(p.seasonPoints, 20);
  assert.equal(p.perGame, 10, "20 points from 2 appearances is 10 a game, not 4");
});

test("profile: a player who has never appeared gets NO rate, not a zero", () => {
  const p = buildPlayerProfile({ playerId: 1, pos: "MID", recent: gws(3, F({ minutes: 0 }), 0) });
  assert.equal(p.perGame, null, "no games is unknown, not bad");
});

test("profile: minutes and points come back oldest-first for the sparkline", () => {
  const recent = [
    { gw: 1, facts: F({ minutes: 90 }), points: 8 },
    { gw: 2, facts: F({ minutes: 62 }), points: 2 },
    { gw: 3, facts: F({ minutes: 0 }), points: 0 },
  ];
  const p = buildPlayerProfile({ playerId: 1, pos: "MID", recent });
  assert.deepEqual(p.minutes, [90, 62, 0]);
  assert.deepEqual(p.points, [8, 2, 0]);
});

test("profile: fixtures carry difficulty so the screen can colour them", () => {
  const p = buildPlayerProfile({
    playerId: 1, pos: "MID", recent: gws(3, F()),
    fixtures: [
      { gw: 6, opponent: "Burnley", oppShort: "BUR", home: true, difficulty: "kind" },
      { gw: 7, opponent: "Arsenal", oppShort: "ARS", home: false, difficulty: "tough" },
    ] as never,
  });
  assert.deepEqual(p.fixtures.map((f) => f.difficulty), ["kind", "tough"]);
  assert.equal(p.fixtures[0].oppShort, "BUR");
});
