/**
 * YourScore Fantasy Football — transfer OPTIMISER. Replaces the single-swap
 * heuristic ranking in advice.ts's `buildCandidates` with a bounded search over
 * SETS of transfers, reasoning about combinations, the hit economy (HIT_POINTS
 * per move beyond earned credits) and the wildcard chip. The transfer decision
 * values the IMMEDIATE gameweek only (see HORIZON_WEIGHTS) — planning further
 * ahead is what drove the over-trading the backtest exposed.
 *
 * Pure, same discipline as engine.ts/advice.ts: no DB, no fetch, no Date.now(),
 * no randomness. Every emitted move is verified against `applyTransfer()` —
 * that verification IS the legality check, never a re-implementation of the
 * engine's own rules (budget, `sellPrice` half-the-rise, positional quota,
 * `MAX_PER_CLUB`).
 *
 * ── Search strategy (the bound, stated honestly) ─────────────────────────────
 * An exhaustive search over all transfer combinations is combinatorial
 * (pool ~700 × squad 15, choose up to ~8 moves) — far too slow for a per-user
 * cron pass. Instead:
 *
 *  1. Shortlist: for each position, keep the top `SHORTLIST_TOP` pool players
 *     by horizon-summed projected points, UNION the `SHORTLIST_CHEAP` cheapest
 *     — the cheap half exists specifically so a "funding" swap (sell an
 *     expensive player for a cheap like-for-like, freeing cash for a big
 *     signing elsewhere) is still in the search space even though that swap
 *     looks bad in isolation. This union, not the top-scorers alone, is what
 *     makes 2-for-1 funding combos reachable at all.
 *  2. Exhaustive pairs: every legal 1-move swap (depth 1) and every legal
 *     2-move sequence built from that shortlist (depth 2) is enumerated in
 *     full and scored NET of hits. This is the part of the search that can
 *     find "sell A to fund B" — the whole reason this module exists over the
 *     old single-swap ranking.
 *  3. Greedy tail: beyond 2 moves, up to the move budget (earned credits +
 *     `MAX_HIT_MOVES` speculative hits, or `MAX_WILDCARD_MOVES` when the
 *     wildcard is active), the search stops being exhaustive and greedily
 *     appends the single best next legal move, recomputed against the
 *     evolving squad, stopping the moment no further move improves the net
 *     total.
 *
 * WHAT THIS CAN MISS (said here, not hidden): a combo that needs 3+ moves
 * where NO 2-move prefix of it is itself an improvement — e.g. sell A, B AND
 * C together to fund one ultra-premium D, where neither "sell A" nor "sell A
 * and B" alone frees enough cash or looks good net of the interim state. Our
 * depth-2 exhaustive search plus greedy tail will not discover that triple
 * because the greedy tail only extends from a state that was already the best
 * 2-move (or fewer) starting point. In practice this is a shrinking-returns
 * scenario (every extra hit costs another flat HIT_POINTS, so 3-hit combos
 * need an increasingly large projection edge to pay for themselves) and we
 * accept the coverage gap rather than pay for full-depth exhaustive search.
 * Similarly, under a wildcard the true optimum is a from-scratch 15-man
 * rebuild; we bound the wildcard search to `MAX_WILDCARD_MOVES` additional
 * swaps on top of the existing squad rather than solve the full knapsack.
 */
import {
  applyTransfer, transferCost, RuleError, SQUAD_SIZE, HIT_POINTS, CASH_POINTS,
  type Squad, type PoolPlayer, type FantasyPos,
} from "./engine";

// ── The contract ──────────────────────────────────────────────────────────────
/** From projection.ts (built in parallel by another agent) — declared locally
 *  per the brief so this module never depends on a file that may not exist
 *  yet. playerId -> [gw+0, gw+1, gw+2] expected YourScore points. */
export type ProjectedPoints = Map<number, number[]>;

export interface OptimiseInput {
  squad: Squad;
  pool: PoolPlayer[];
  projected: ProjectedPoints;
  credits: number;          // quiz-earned, bankable, cashable
  /** The free transfer everyone gets each gameweek. Expires, never cashes —
   *  so it is spent FIRST and its opportunity cost is genuinely zero. */
  weeklyFree?: number;
  wildcardActive: boolean;
  unavailable?: Set<number>; // player ids that must never be bought
  /** When set, only these squad members may be SOLD. This is what turns the
   *  optimiser into the user-driven planner: the manager names the players
   *  they're considering moving on, and the search is confined to those.
   *
   *  It is a restriction, never an instruction — the search still chooses how
   *  many of them to actually sell, and may still return `hold` if none of the
   *  marked players is worth replacing. "Considering" is the user's word for
   *  it, and it is the right one.
   *
   *  Undefined (the default) means the whole squad is sellable, which is the
   *  cron's behaviour and unchanged. */
  onlyOutIds?: Set<number>;
  /** How many same-position buys per position the search may consider, as
   *  {top by projection, cheapest}. The cheap half is the funding half — it is
   *  what makes "sell an expensive dud for a cheap like-for-like to bankroll a
   *  premium elsewhere" reachable at all, so it is never dropped.
   *
   *  Undefined uses the cron's own bound (SHORTLIST_TOP / SHORTLIST_CHEAP). The
   *  planner widens it, because with the out-set fixed to a few named players
   *  it can afford to — but only up to a point, and the point is measured, not
   *  guessed: see the width budget in planTransfers. */
  marketWidth?: { top: number; cheap: number };
}
export interface OptimisedMove { outId: number; inId: number; paid: "credit" | "hit" | "free"; gain: number }
export interface OptimiseResult {
  moves: OptimisedMove[];
  totalGain: number;
  hitsTaken: number;
  hold: boolean;
  consideredCombinations: number;
}

// ── Tunables (the bound, as constants) ────────────────────────────────────────
const SHORTLIST_TOP = 10;   // per-position candidates kept by projected points
const SHORTLIST_CHEAP = 6;  // per-position candidates kept by lowest price — the funding half
const MAX_HIT_MOVES = 3;    // speculative hits considered beyond earned credits
const MAX_WILDCARD_MOVES = 8; // bound on a wildcard's free-move search (not a full 15-man rebuild)

/** How much each gameweek of the projection horizon counts toward a transfer
 *  decision. THE fix for the over-trading the backtest exposed (196 transfers /
 *  93 hits a season vs a sensible ~50/0).
 *
 *  IMMEDIATE-WEEK ONLY (founder call, and the evidence backs it). The old code
 *  summed all three gameweeks at full weight while a -4 hit is paid ONCE, so a
 *  move gaining a trivial 1.4 pts/week cleared the hit bar (1.4x3 > 4). Worse,
 *  the optimiser re-decides EVERY week — it books a three-week case, then sells
 *  the player before those weeks arrive, paying another -4. Planning ahead in
 *  this game is building on sand anyway: next week's transfers depend on next
 *  week's quiz, prices move, players get injured. And the strategy that WON the
 *  backtest (season-to-date average) has zero lookahead. So the transfer
 *  decision values THIS gameweek and nothing else; a hit must earn its -4 this
 *  week, not on a distant guess. (One weight = only projected[0] is ever read.) */
const HORIZON_WEIGHTS = [1.0];

/** A pure NOISE floor, on top of whatever the move actually costs. Projections
 *  carry real error, so a move projected a hair better than the alternative is
 *  not reliably better at all — this stops the search acting on rounding.
 *
 *  It used to be 8 and doing a second job badly: standing in for the ECONOMIC
 *  cost of a move, which is now modelled explicitly (see marginalCostOf). That
 *  conflation made the optimiser demand ~8 points before spending a credit
 *  worth 4, so it hoarded credits until they overflowed and finished 78 points
 *  BEHIND a greedy baseline that simply spent them. Small now, and honest about
 *  what it is.
 *
 *  0.75 on FPL's scale (was 2.0 on the old ~2.6x one — same size floor, new
 *  units). Deliberately not a whole number: a whole point is a real chunk of an
 *  FPL projection, and this is only meant to swallow rounding. */
export const MOVE_MARGIN = 0.75;

// ── Internal move representation (before payment is assigned) ────────────────
interface RawMove { outId: number; inId: number; rawGain: number }

function tryApply(squad: Squad, outId: number, inId: number, pool: PoolPlayer[]): Squad | null {
  try {
    return applyTransfer(squad, outId, inId, pool);
  } catch (e) {
    if (e instanceof RuleError) return null; // illegal move — exactly the discard this search exists for
    throw e;
  }
}

/** Horizon-DISCOUNTED projected points for a player; unknown/missing -> 0 (never
 *  crash on a pool player projection.ts hasn't scored yet). Each gameweek is
 *  weighted by HORIZON_WEIGHTS so a near-term point counts more than a distant
 *  one — see that constant for why this is the over-trading fix. A projection
 *  longer than the weight table is truncated to the horizon we actually value;
 *  a shorter one just uses the weights it has. */
function projTotalOf(id: number, projected: ProjectedPoints): number {
  const arr = projected.get(id);
  if (!arr || !arr.length) return 0;
  let sum = 0;
  for (let i = 0; i < arr.length && i < HORIZON_WEIGHTS.length; i++) sum += arr[i] * HORIZON_WEIGHTS[i];
  return sum;
}

/** Per-position shortlist: top-projected UNION cheapest, deduped, sorted by id
 *  for deterministic iteration order regardless of score/price ties. */
function buildBranchCandidates(
  pool: PoolPlayer[], squad: Squad, unavailable: Set<number>,
  projTotal: (id: number) => number,
  width: { top: number; cheap: number } = { top: SHORTLIST_TOP, cheap: SHORTLIST_CHEAP },
): Record<FantasyPos, PoolPlayer[]> {
  const owned = new Set(squad.picks.map((p) => p.id));
  const byPos: Record<FantasyPos, PoolPlayer[]> = { GK: [], DEF: [], MID: [], FWD: [] };
  for (const p of pool) {
    if (owned.has(p.id) || unavailable.has(p.id)) continue; // never re-buy owned; never buy a flagged id
    byPos[p.pos].push(p);
  }
  const result: Record<FantasyPos, PoolPlayer[]> = { GK: [], DEF: [], MID: [], FWD: [] };
  for (const pos of Object.keys(byPos) as FantasyPos[]) {
    const list = byPos[pos];
    const byProjDesc = [...list].sort((a, b) => projTotal(b.id) - projTotal(a.id) || a.id - b.id).slice(0, width.top);
    const byPriceAsc = [...list].sort((a, b) => a.priceTenths - b.priceTenths || a.id - b.id).slice(0, width.cheap);
    const merged = new Map<number, PoolPlayer>();
    for (const p of byProjDesc) merged.set(p.id, p);
    for (const p of byPriceAsc) merged.set(p.id, p);
    result[pos] = Array.from(merged.values()).sort((a, b) => a.id - b.id);
  }
  return result;
}

/** Every LEGAL 1-for-1 swap from the current squad state into the shortlist —
 *  the legality check (`tryApply`) is not a filter bolted on afterward, it is
 *  how the candidate list is built at all. */
function singleMoves(
  squad: Squad, pool: PoolPlayer[], branch: Record<FantasyPos, PoolPlayer[]>,
  projTotal: (id: number) => number, onlyOutIds?: Set<number>,
): RawMove[] {
  const moves: RawMove[] = [];
  for (const out of squad.picks) {
    if (onlyOutIds && !onlyOutIds.has(out.id)) continue;
    const outProj = projTotal(out.id);
    for (const cand of branch[out.pos]) {
      if (!tryApply(squad, out.id, cand.id, pool)) continue;
      moves.push({ outId: out.id, inId: cand.id, rawGain: projTotal(cand.id) - outProj });
    }
  }
  return moves;
}

/** Defensive replay: re-runs the chosen sequence through `applyTransfer` from
 *  the ORIGINAL squad, truncating at the first failure. Search is expected to
 *  never produce an illegal move (every step was itself checked via
 *  `tryApply`), but this is the module's own hard guarantee — it costs almost
 *  nothing to re-verify, and it means a search bug can never surface as a
 *  broken payload, only as a silently shorter (still 100% legal) move list. */
function replayValidate(squad: Squad, pool: PoolPlayer[], seq: RawMove[]): RawMove[] {
  let cur = squad;
  const survived: RawMove[] = [];
  for (const m of seq) {
    const next = tryApply(cur, m.outId, m.inId, pool);
    if (!next) break;
    survived.push(m);
    cur = next;
  }
  return survived;
}

export function optimiseTransfers(input: OptimiseInput): OptimiseResult {
  const { squad, pool, projected, credits, wildcardActive } = input;
  // 0 when the caller says nothing. The baseline move everyone gets is granted
  // as a credit at gameweek rollover (`grantBaseline`), so it arrives here
  // inside `credits`; defaulting to 1 would count it a second time and make the
  // search believe one more move is free than actually is.
  const weeklyFree = input.weeklyFree ?? 0;
  const unavailable = input.unavailable ?? new Set<number>();
  const projTotal = (id: number) => projTotalOf(id, projected);

  const branch = buildBranchCandidates(pool, squad, unavailable, projTotal, input.marketWidth);
  const onlyOutIds = input.onlyOutIds;

  // The anti-churn margin gates moves that COST something — a scarce credit, or
  // a -4 hit. A wildcard move costs nothing (it's a free full rebuild), so the
  // margin must not apply: under a wildcard you take every projected upgrade,
  // even a small one, because leaving a free improvement on the bench is
  // strictly worse. Off a wildcard, every move spends a credit or a hit, so the
  // margin holds. (A wildcard move must still be a genuine improvement — the
  // search only ever accepts net > current, so a zero-gain swap is never made.)
  const margin = wildcardActive ? 0 : MOVE_MARGIN;

  let considered = 0;

  // Net value of a candidate sequence of length `len` and raw (un-hit-adjusted)
  // point total `raw`: wildcard moves are always free; otherwise the (len -
  // credits) moves beyond earned credits each cost a flat HIT_POINTS. Which
  // SPECIFIC move in the sequence is tagged "hit" doesn't affect this total —
  // only the count does — so search comparisons can use this directly and
  // defer the actual per-move `paid` labelling to the end.
  // What the (i+1)-th move of a sequence actually COSTS, in points. This is the
  // economy, stated once, instead of a single flat hit rate:
  //   - a wildcard move costs nothing (that is the chip)
  //   - the WEEKLY FREE transfer costs nothing REALLY — it expires at the end of
  //     the gameweek and cannot be cashed, so declining to use it banks zero.
  //     Spending it is free money; the old flat model priced it like a credit
  //     and left it on the table.
  //   - a quiz-earned CREDIT costs CASH_POINTS, because that is what it would
  //     have paid out had it overflowed. That is its floor value and therefore
  //     the true opportunity cost of spending it.
  //   - anything beyond that costs a full HIT_POINTS.
  const marginalCostOf = (i: number): number => {
    if (wildcardActive) return 0;
    if (i < weeklyFree) return 0;
    if (i < weeklyFree + credits) return CASH_POINTS;
    return HIT_POINTS;
  };
  const costOf = (len: number): number => {
    let c = 0;
    for (let i = 0; i < len; i++) c += marginalCostOf(i);
    return c;
  };
  const netOf = (len: number, raw: number) => raw - costOf(len);

  // ── depth 1: every legal single swap ────────────────────────────────────────
  const m1s = singleMoves(squad, pool, branch, projTotal, onlyOutIds);
  considered += m1s.length;

  // Holding is the default and it must be BEATEN BY A MARGIN, not merely tied
  // or nudged. bestNet starts at MOVE_MARGIN, so no sequence is chosen unless it
  // clears holding by that much — the anti-churn floor that stops the optimiser
  // trading on projection noise (see MOVE_MARGIN).
  let bestSeq: RawMove[] = []; // [] = hold, net 0
  let bestNet = margin;

  for (const m of m1s) {
    const net = netOf(1, m.rawGain);
    if (net > bestNet) { bestNet = net; bestSeq = [m]; }
  }

  // ── depth 2: exhaustive pairs — THE combinatorial case this module exists
  // for (sell two to fund one). Recomputes legality/gain against the squad
  // state AFTER m1, so a pair where m1 alone looks bad (a funding sale) but
  // unlocks a great m2 is scored on its TOTAL, never discarded for m1's sake.
  for (const m1 of m1s) {
    const squad1 = tryApply(squad, m1.outId, m1.inId, pool);
    if (!squad1) continue; // defensive; m1 already passed tryApply once above
    const m2s = singleMoves(squad1, pool, branch, projTotal, onlyOutIds);
    considered += m2s.length;
    for (const m2 of m2s) {
      const raw = m1.rawGain + m2.rawGain;
      const net = netOf(2, raw);
      if (net > bestNet) { bestNet = net; bestSeq = [m1, m2]; }
    }
  }

  // ── greedy tail: depth 3..moveBudget, one best-next-move at a time ─────────
  const moveBudget = wildcardActive
    ? Math.min(SQUAD_SIZE, MAX_WILDCARD_MOVES)
    : Math.min(SQUAD_SIZE, weeklyFree + credits + MAX_HIT_MOVES);

  if (moveBudget > bestSeq.length) {
    let curSquad = squad;
    for (const m of bestSeq) curSquad = tryApply(curSquad, m.outId, m.inId, pool) ?? curSquad;
    let rawSoFar = bestSeq.reduce((s, m) => s + m.rawGain, 0);

    for (;;) {
      if (bestSeq.length >= moveBudget) break;
      const nextMoves = singleMoves(curSquad, pool, branch, projTotal, onlyOutIds);
      considered += nextMoves.length;

      let bestNext: RawMove | null = null;
      let bestNextNet = -Infinity;
      for (const cand of nextMoves) {
        const net = netOf(bestSeq.length + 1, rawSoFar + cand.rawGain);
        if (net > bestNextNet) { bestNextNet = net; bestNext = cand; }
      }
      const netNow = netOf(bestSeq.length, rawSoFar);
      // Each ADDITIONAL move must clear the same anti-churn margin over the
      // current state — otherwise a move the depth-1 check rejected could slip
      // in here (the tail starts from hold, netNow 0, when nothing beat the
      // margin above). No margin, no move.
      if (!bestNext || bestNextNet <= netNow + margin) break;

      const applied = tryApply(curSquad, bestNext.outId, bestNext.inId, pool);
      if (!applied) break; // defensive
      bestSeq = [...bestSeq, bestNext];
      rawSoFar += bestNext.rawGain;
      curSquad = applied;
    }
  }

  // ── finalise: defensive replay, then assign payment via the ENGINE's own
  // transferCost() sequentially (never re-derive the credit/hit rule) ────────
  const survived = replayValidate(squad, pool, bestSeq);

  // Payment labelling uses the ENGINE's own rule, spending the perishable
  // weekly free transfer before any bankable credit — same order marginalCostOf
  // priced the search with, so the labels can never disagree with the maths.
  let freeLeft = weeklyFree;
  let creditsLeft = credits;
  let hitsTaken = 0;
  const moves: OptimisedMove[] = survived.map((m) => {
    const { paid } = transferCost(creditsLeft, wildcardActive, freeLeft);
    if (paid === "free" && !wildcardActive && freeLeft > 0) freeLeft--;
    else if (paid === "credit") creditsLeft--;
    else if (paid === "hit") hitsTaken++;
    return { outId: m.outId, inId: m.inId, paid, gain: m.rawGain };
  });

  // Net of what the moves actually cost — hits AND the cash value forgone on
  // every credit spent. Counting only hits overstated the gain of a
  // credit-funded move, which is the same hoarding blind spot in another form.
  const totalGain = moves.reduce((s, m) => s + m.gain, 0) - costOf(moves.length);

  return { moves, totalGain, hitsTaken, hold: moves.length === 0, consideredCombinations: considered };
}

// ═══════════════════════════════════════════════════════════════════════════
// THE PLANNER — "here are the players I'm thinking of dropping"
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Why this exists, and why it is better than the tool telling you who to drop.
 *
 * The season backtest measured the combinatorial optimiser losing to a plain
 * greedy — "swap your worst player for the best you can afford" — in every
 * configuration tested, at p < 0.05. Three explanations were raised and all
 * three were killed by data: it was not a bad projection (fed the identical
 * one, it still lost by 78 points), not credit hoarding (forcing more transfers
 * made it worse), and not a narrow shortlist (across 300 trials the greedy's
 * best move was already INSIDE the optimiser's shortlist 88% of the time — it
 * saw the move and declined it).
 *
 * What is left is that choosing WHICH of your players to move on is the part
 * the search is worst at, and it is also the part a manager already has an
 * opinion about. They watched the game. They know the striker has not had a
 * shot in a month and that the defender has just lost his place. So the planner
 * hands that decision back and keeps the parts a search is genuinely good at:
 *
 *  - checking every legal replacement rather than the ones you thought of,
 *  - the money — selling two to fund one, at the real half-the-rise sell price,
 *  - and the cost of the moves, in the order the engine actually charges them.
 *
 * It can also say no. If a manager marks their best player, the honest answer
 * is that nothing available beats him, and `perPlayer` says so explicitly
 * rather than shuffling the squad to look busy.
 */
export interface PlanInput extends OptimiseInput {
  /** Squad ids the manager is considering moving on. Ids that aren't in the
   *  squad are reported back in `ignored` rather than silently dropped — a
   *  stale id from an open tab should be visible, not invisible. */
  considering: number[];
}

/** The verdict on ONE player the manager marked, independent of the plan. This
 *  is what makes the screen honest: a player can be left out of the plan
 *  because nothing beats him (`bestInId: null`), or because the money went
 *  further elsewhere (`bestInId` set, `inPlan` false) — and those are very
 *  different things to tell someone. */
export interface PlayerVerdict {
  outId: number;
  /** His best single legal replacement, judged from the CURRENT squad on its
   *  own — not from the state after the plan's other moves. Null when no legal
   *  same-position buy improves on him at all. */
  bestInId: number | null;
  /** Projected points that single swap would gain this gameweek, BEFORE what
   *  the move costs. The plan reports cost; this reports upside. */
  gain: number;
  /** Whether the plan actually sold him. */
  inPlan: boolean;
}

export interface PlanResult extends OptimiseResult {
  perPlayer: PlayerVerdict[];
  /** Ids passed in `considering` that are not in the squad. */
  ignored: number[];
}

/** How wide a market the planner may search, given how many players the manager
 *  marked. This is a LATENCY budget and the numbers come from measurement, not
 *  taste: the depth-2 pair search is exhaustive, so its cost grows with roughly
 *  (marked x width) squared. Unbounded at a real 700-player pool, five marked
 *  players took 7.8 SECONDS — fine for a nightly cron, useless for someone
 *  tapping names on a screen. Holding `marked x width` near constant keeps every
 *  selection size under about a second.
 *
 *  One marked player is the exception and gets the entire market: with a single
 *  sellable player there is no pair search at all (once he is sold there is
 *  nobody left to sell), so the quadratic term vanishes and the widest possible
 *  answer costs almost nothing — measured at 6ms. */
const PLANNER_MOVE_BUDGET = 200;
function plannerMarketWidth(marked: number): { top: number; cheap: number } | undefined {
  if (marked <= 1) return { top: Number.MAX_SAFE_INTEGER, cheap: Number.MAX_SAFE_INTEGER };
  const total = Math.max(24, Math.floor(PLANNER_MOVE_BUDGET / marked));
  // The cheap quarter is the funding half of the shortlist and must survive any
  // narrowing — a planner that can't sell to fund is just a list of swaps.
  const cheap = Math.max(8, Math.round(total / 4));
  return { top: total - cheap, cheap };
}

export function planTransfers(input: PlanInput): PlanResult {
  const { squad, pool, projected, considering } = input;
  const owned = new Set(squad.picks.map((p) => p.id));
  const marked = considering.filter((id) => owned.has(id));
  const ignored = considering.filter((id) => !owned.has(id));
  const onlyOutIds = new Set(marked);

  // Nothing to plan. Returning a well-formed empty result beats throwing: an
  // empty selection is a normal UI state (the screen before you tap anyone),
  // not an error.
  if (marked.length === 0) {
    return {
      moves: [], totalGain: 0, hitsTaken: 0, hold: true, consideredCombinations: 0,
      perPlayer: [], ignored,
    };
  }

  const marketWidth = plannerMarketWidth(marked.length);
  const result = optimiseTransfers({ ...input, onlyOutIds, marketWidth });

  // Per-player verdicts are computed from the ORIGINAL squad, one player at a
  // time, so each answers "what is the best I could do for HIM" rather than
  // "what was left after the other moves". Those are different questions and
  // the manager is asking the first one.
  const projTotal = (id: number) => projTotalOf(id, projected);
  // The per-player verdicts are one out-player at a time, so they always get the
  // whole market however many were marked — there is no pair search to bound and
  // "the best replacement for HIM" should never be a truncated answer.
  const branch = buildBranchCandidates(
    pool, squad, input.unavailable ?? new Set<number>(), projTotal,
    { top: Number.MAX_SAFE_INTEGER, cheap: Number.MAX_SAFE_INTEGER },
  );
  const soldByPlan = new Set(result.moves.map((m) => m.outId));

  const perPlayer: PlayerVerdict[] = marked.map((outId) => {
    const solo = singleMoves(squad, pool, branch, projTotal, new Set([outId]));
    let best: RawMove | null = null;
    for (const m of solo) {
      // Ties break on the lower id so the same squad always yields the same
      // advice — this module is pure and must stay reproducible.
      if (!best || m.rawGain > best.rawGain || (m.rawGain === best.rawGain && m.inId < best.inId)) best = m;
    }
    return {
      outId,
      bestInId: best && best.rawGain > 0 ? best.inId : null,
      gain: best && best.rawGain > 0 ? best.rawGain : 0,
      inPlan: soldByPlan.has(outId),
    };
  });

  return { ...result, perPlayer, ignored };
}
