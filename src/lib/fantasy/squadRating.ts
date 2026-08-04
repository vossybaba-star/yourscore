/**
 * Squad Rating — "Rate my squad", a single 0 to 10 score for the fifteen a
 * manager has actually built, plus a one line verdict, the XI grouped into
 * strong/decent/weak bands, and one suggested move.
 *
 * ── The shape of the guarantee (same discipline as scoutPicks.ts) ───────────
 * The SCORE is 100% code: five sub scores, each a deterministic function of one
 * FPL snapshot batch + one fantasyContext() fixture read, weighted and rounded.
 * The BANDS are 100% code too (bandPlayers()): every XI player is grouped by a
 * deterministic ratio against the realistic ceiling for their position. Nothing
 * here ever asks a model to judge the squad. The model is handed a CLOSED
 * payload (ratingFacts()) built from the score and bands that have ALREADY been
 * computed, and may only rephrase it into a short verdict — grounded against
 * the exact same discipline tips.ts proved out (collectPayloadTokens,
 * isProseGrounded, hasUngroundedClaim, cleanField, reused here, not copied). A
 * verdict that fails grounding — or this file's own no-dash lint — never
 * blocks the rating: it falls back to a line composed by CODE from the score,
 * `copy_source` records which happened, and the rating still ships. No key /
 * API failure / grounding failure means the deterministic score, bands and
 * templated prose still render — never blocked on the LLM.
 *
 * ── Caching ───────────────────────────────────────────────────────────────
 * squadHash() is a pure function of the fifteen, the XI, the bench and the
 * captain/vice — change any of those and the hash changes, which is the cache
 * key. A GET (peek) NEVER computes: it only ever returns a previously stored
 * row for the CURRENT hash, or nothing. A plain POST reuses a stored row for
 * the same hash with zero model calls; only a genuinely new hash computes (one
 * model call) and only `{fresh:true}` forces a recompute of an existing hash,
 * throttled separately (see the route) so "give me another take" can't be
 * spammed into a cost hole.
 *
 * ── Two horizons ──────────────────────────────────────────────────────────
 * Every rating now ships TWO scored takes on the same fifteen, computed from
 * the same RatingInputs: MONTH (the August competition — weighted toward the
 * whole fixture run and availability right now) and SEASON (weighted toward
 * projection and differentials over the long haul). One model call produces
 * BOTH verdicts (see callModelForHorizons/RATING_SYSTEM below) — never two —
 * grounded against a combined facts payload carrying both horizons at once.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MAX_PER_CLUB, XI_SIZE, type FantasyPos } from "./engine";
import { pricedPool } from "./pool";
import { fantasyContext } from "./context";
import { faceUrlById } from "./faces";
import { rateLimitDistributed } from "@/lib/ratelimit";
import {
  cleanField, collectPayloadTokens, hasUngroundedClaim, isProseGrounded,
} from "./tips";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = SupabaseClient<any, "public", any>;

const MODEL = "claude-sonnet-5";

/** Thrown by rateSquad() when a {fresh:true} recompute is over the daily
 *  allowance. A distinct class (not @/lib/fantasy/server's HttpError) so this
 *  file never has to import server.ts's much larger dependency graph — the
 *  route bridges this into the real HttpError/429. */
export class SquadRatingRateLimitError extends Error {}

const DAY_MS = 86_400_000;
/** Per-user daily cap on ACTUAL model computes (a cache hit costs nothing). This
 *  is the cost guard: every new squad hash is a miss that would otherwise bill a
 *  model call, and shuffling the captain or XI mints new hashes without limit. A
 *  cache hit, and the three-a-day fresh takes, both draw from this same budget. */
const DAILY_COMPUTE_CAP = 20;

export type Difficulty = "kind" | "medium" | "tough";
export type CopySource = "model" | "mechanical";

// ── candidate shape (one entry per squad member, or per replacement option) ─

export interface RatingPlayer {
  id: number;
  name: string;
  club: string;
  clubId: number;
  pos: FantasyPos;
  priceTenths: number;
  status: string; // FPL letter: a/d/i/s/u
  chance: number | null;
  epNext: number | null;
  ownershipPct: number | null;
}

/** The one frozen view every sub score and the suggested move rank against —
 *  built once per rating, never re-read mid-calculation. `pool` is every
 *  available (status 'a') snapshot player, for the replacement search in
 *  deriveMove(); it is allowed to include the manager's own players, since
 *  deriveMove() filters ownership itself. */
export interface RatingInputs {
  gameweek: number;
  xi: RatingPlayer[];
  bench: RatingPlayer[];
  captainId: number;
  bankTenths: number;
  pool: RatingPlayer[];
  /** clubId -> its upcoming fixture cells, soonest first (mirrors
   *  FantasyContext.fixtures from context.ts). An EMPTY object here is the
   *  all-or-nothing "we don't trust any of this batch" signal, not "every
   *  club has a blank gameweek" — see computeSFix(). */
  fixtures: Record<number, { difficulty: Difficulty }[]>;
}

/** Pure mapping from already-fetched rows into the frozen RatingInputs shape.
 *  Exported mainly for the unit tests and to keep rateSquad()'s DB-reading
 *  code from also being the code that decides what counts as XI/bench. */
export function buildRatingInputs(params: {
  gameweek: number;
  squadPlayers: RatingPlayer[]; // all 15, any order
  xiIds: number[];
  benchIds: number[];
  captainId: number;
  bankTenths: number;
  pool: RatingPlayer[];
  fixtures: Record<number, { difficulty: Difficulty }[]>;
}): RatingInputs {
  const byId = new Map(params.squadPlayers.map((p) => [p.id, p]));
  const xi = params.xiIds.map((id) => byId.get(id)).filter((p): p is RatingPlayer => !!p);
  const bench = params.benchIds.map((id) => byId.get(id)).filter((p): p is RatingPlayer => !!p);
  return {
    gameweek: params.gameweek, xi, bench, captainId: params.captainId,
    bankTenths: params.bankTenths, pool: params.pool, fixtures: params.fixtures,
  };
}

// ── cache key (pure — acceptance criterion 6) ────────────────────────────────

/** A deterministic fingerprint of "what would change the rating": the fifteen,
 *  who's in the XI, who's on the bench, and who's captain/vice. Order-
 *  independent on the id lists (a rebuild that reorders picks without
 *  changing membership must NOT bust the cache); captain/vice are compared by
 *  VALUE, not membership, so swapping the armband between two players already
 *  in the XI still changes the hash. No crypto import — a small FNV-1a-style
 *  string hash is plenty for a cache key and keeps this file dependency-free
 *  for the pure test compile. */
export function squadHash(
  picks: { id: number }[],
  xi: number[],
  bench: number[],
  captain: number,
  vice: number,
): string {
  const key = [
    picks.map((p) => p.id).slice().sort((a, b) => a - b).join(","),
    xi.slice().sort((a, b) => a - b).join(","),
    bench.slice().sort((a, b) => a - b).join(","),
    String(captain),
    String(vice),
  ].join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

// ── the score formula (deterministic, weighted, one decimal) ────────────────

export const W_PROJ = 0.35;
export const W_AVAIL = 0.25;
export const W_FIX = 0.15;
export const W_BAL = 0.15;
export const W_DIFF = 0.10;

/** Projection is scored on a band anchored to the LIVE data, not a fixed points
 *  total. Pre-season FPL's ep_next values are tiny (a top XI barely projects into
 *  the 40s); mid-season they ramp. A fixed 35-70 band floored every pre-season
 *  squad at zero, which killed the biggest-weighted dimension. Instead "10" is a
 *  strong XI's projection computed from the current pool (benchmarkRaw), and "0"
 *  is this fraction of it (a weak but real XI). The fraction is set so an average
 *  squad lands near the middle; the whole band moves with the season's scale. */
export const PROJ_FLOOR_FRACTION = 0.62;

const AVAIL_START = 10;
const AVAIL_XI_OUT_PENALTY = 3;
const AVAIL_XI_DOUBT_PENALTY = 1.5;
const AVAIL_BENCH_OUT_PENALTY = 0.5;
const AVAIL_CHANCE_FLOOR = 75;

const FIX_BASE = 5;

const BAL_BANK_FREE_TENTHS = 20; // £2.0m
const BAL_PENALTY_STEP_TENTHS = 20; // £2.0m per point off

export const DIFF_OWNERSHIP_CEILING = 10;
export const DIFF_EPNEXT_FLOOR = 3;
const DIFF_BASE = 2;
const DIFF_STEP = 2.5;
const DIFF_TEMPLATE_MEAN_OWNERSHIP = 40;
const DIFF_TEMPLATE_SCORE = 2;

const OUT_STATUSES = new Set(["i", "s", "u"]);

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

export interface SubScores {
  sProj: number;
  sAvail: number;
  sFix: number;
  sBal: number;
  sDiff: number;
}

export interface ScoreResult {
  score: number;
  subScores: SubScores;
  flags: { allTemplate: boolean };
  raw: { projRaw: number; benchmark: number };
}

/** The shape a strong XI's projection is measured in — a standard 4-4-2. */
const BENCH_SHAPE = { GK: 1, DEF: 4, MID: 4, FWD: 2 } as const;

/** A strong XI's projected raw score, from the available pool: the best
 *  ep_next in a 4-4-2 shape plus the single best player doubled (as a captain
 *  would be). This is the live "10" anchor for the projection sub score, so
 *  the band tracks the current ep_next scale instead of a fixed guess. Pure. */
export function benchmarkRaw(pool: RatingPlayer[]): number {
  const topByPos = (pos: FantasyPos, n: number): number =>
    pool.filter((p) => p.pos === pos).map((p) => p.epNext ?? 0).sort((a, b) => b - a)
      .slice(0, n).reduce((s, v) => s + v, 0);
  const xiSum = topByPos("GK", BENCH_SHAPE.GK) + topByPos("DEF", BENCH_SHAPE.DEF)
    + topByPos("MID", BENCH_SHAPE.MID) + topByPos("FWD", BENCH_SHAPE.FWD);
  const best = pool.reduce((m, p) => Math.max(m, p.epNext ?? 0), 0);
  return xiSum + best;
}

function computeSProj(inputs: RatingInputs): { value: number; raw: number; benchmark: number } {
  const sum = inputs.xi.reduce((s, p) => s + (p.epNext ?? 0), 0);
  const captain = inputs.xi.find((p) => p.id === inputs.captainId);
  const raw = sum + (captain?.epNext ?? 0); // captain counted twice
  const benchmark = benchmarkRaw(inputs.pool);
  const floor = benchmark * PROJ_FLOOR_FRACTION;
  const value = benchmark > floor ? clamp(((raw - floor) / (benchmark - floor)) * 10, 0, 10) : 5;
  return { value, raw, benchmark };
}

/** Exported for the unit tests to drive each branch directly. */
export function computeSAvail(inputs: Pick<RatingInputs, "xi" | "bench">): number {
  let score = AVAIL_START;
  for (const p of inputs.xi) {
    if (OUT_STATUSES.has(p.status)) score -= AVAIL_XI_OUT_PENALTY;
    else if (p.status === "d" || (p.chance !== null && p.chance < AVAIL_CHANCE_FLOOR)) score -= AVAIL_XI_DOUBT_PENALTY;
  }
  for (const p of inputs.bench) {
    if (OUT_STATUSES.has(p.status)) score -= AVAIL_BENCH_OUT_PENALTY;
  }
  return clamp(score, 0, 10);
}

/** Exported for the unit tests. `fixtures` empty ({}) is the all-or-nothing
 *  "context couldn't map any club" signal (see context.ts) — every XI player
 *  scores as medium (0 contribution) rather than as a blank gameweek. */
export function computeSFix(inputs: Pick<RatingInputs, "xi" | "fixtures">): number {
  if (Object.keys(inputs.fixtures).length === 0) return FIX_BASE;
  let sum = 0;
  for (const p of inputs.xi) {
    const cell = inputs.fixtures[p.clubId]?.[0];
    if (!cell) sum -= 1;
    else if (cell.difficulty === "kind") sum += 1;
    else if (cell.difficulty === "tough") sum -= 1;
  }
  return clamp(FIX_BASE + 5 * (sum / XI_SIZE), 0, 10);
}

/** One XI player's fixture-RUN value: sum of kind:+1 / tough:-1 / medium:0
 *  across their club's run cells (up to 5, soonest first), divided by the
 *  cells actually present (min 1). A club with no cells at all in a non-empty
 *  map counts as a single missing cell (-1) — the same "don't trust a blank"
 *  signal computeSFix() uses for a missing next-GW cell, extended to the run.
 *  Exported: shared by computeSFixRun() below, bandPlayersMonth() and
 *  deriveMonthMove(), so all three read the identical per-player number. */
export function playerFixtureRunValue(clubId: number, fixtures: RatingInputs["fixtures"]): number {
  const cells = fixtures[clubId];
  if (!cells || !cells.length) return -1;
  const run = cells.slice(0, 5);
  let sum = 0;
  for (const cell of run) {
    if (cell.difficulty === "kind") sum += 1;
    else if (cell.difficulty === "tough") sum -= 1;
  }
  return sum / run.length;
}

/** Exported for the unit tests. The MONTH horizon's fixture sub score — the
 *  computeSFix() shape (FIX_BASE +/- 5 on the XI mean) but averaged over each
 *  player's whole fixture RUN (playerFixtureRunValue) instead of just the next
 *  GW, so a squad's August is judged on the whole month, not one game. Same
 *  all-or-nothing empty-map rule as computeSFix(): an empty fixtures map means
 *  "don't trust this batch", not "every club has a blank run" — return neutral
 *  (5), not a punished 0. */
export function computeSFixRun(inputs: Pick<RatingInputs, "xi" | "fixtures">): number {
  if (Object.keys(inputs.fixtures).length === 0) return FIX_BASE;
  const xiSum = inputs.xi.reduce((s, p) => s + playerFixtureRunValue(p.clubId, inputs.fixtures), 0);
  return clamp(FIX_BASE + 5 * (xiSum / XI_SIZE), 0, 10);
}

/** Exported for the unit tests. */
export function computeSBal(inputs: Pick<RatingInputs, "xi" | "bankTenths">): number {
  if (inputs.xi.length !== XI_SIZE) return 5;
  const excess = Math.max(0, inputs.bankTenths - BAL_BANK_FREE_TENTHS);
  const penalty = Math.floor(excess / BAL_PENALTY_STEP_TENTHS);
  return clamp(10 - penalty, 0, 10);
}

/** Exported for the unit tests. */
export function computeSDiff(inputs: Pick<RatingInputs, "xi">): { value: number; allTemplate: boolean } {
  const diffs = inputs.xi.filter(
    (p) => p.ownershipPct !== null && p.ownershipPct < DIFF_OWNERSHIP_CEILING && (p.epNext ?? 0) >= DIFF_EPNEXT_FLOOR,
  ).length;
  if (diffs === 0) {
    const known = inputs.xi.filter((p) => p.ownershipPct !== null);
    const mean = known.length ? known.reduce((s, p) => s + (p.ownershipPct ?? 0), 0) / known.length : 0;
    if (mean >= DIFF_TEMPLATE_MEAN_OWNERSHIP) return { value: DIFF_TEMPLATE_SCORE, allTemplate: true };
  }
  return { value: Math.min(10, DIFF_BASE + DIFF_STEP * diffs), allTemplate: false };
}

/** The whole score: five sub scores, weighted, rounded to one decimal. Pure
 *  and deterministic — the same RatingInputs always yields the same output
 *  (acceptance criterion 1). */
export function scoreSquad(inputs: RatingInputs): ScoreResult {
  const proj = computeSProj(inputs);
  const sAvail = computeSAvail(inputs);
  const sFix = computeSFix(inputs);
  const sBal = computeSBal(inputs);
  const diff = computeSDiff(inputs);
  const subScores: SubScores = { sProj: proj.value, sAvail, sFix, sBal, sDiff: diff.value };
  const score = round1(
    W_PROJ * subScores.sProj + W_AVAIL * subScores.sAvail + W_FIX * subScores.sFix
    + W_BAL * subScores.sBal + W_DIFF * subScores.sDiff,
  );
  return { score, subScores, flags: { allTemplate: diff.allTemplate }, raw: { projRaw: proj.raw, benchmark: proj.benchmark } };
}

// ── two-horizon weights (scoreSquad()/W_* above stay untouched — the pure
//    single-score path the existing tests exercise; the two horizons below
//    are a second, additive scoring path built from the same sub scores) ────

export interface HorizonWeights { proj: number; avail: number; fix: number; bal: number; diff: number }

/** MONTH weights the August competition: the fixture run (fixRun, not the
 *  single next-GW sFix) carries the most weight, availability matters right
 *  now, differentials matter least — a differential three gameweeks out is
 *  not what wins August. */
export const MONTH_WEIGHTS: HorizonWeights = { proj: 0.25, avail: 0.20, fix: 0.35, bal: 0.10, diff: 0.10 };

/** SEASON weights lasting value: projection and differentials carry the most
 *  weight, the fixture term drops to the single next-GW sFix at low weight —
 *  one gameweek's fixture barely matters over a whole season. */
export const SEASON_WEIGHTS: HorizonWeights = { proj: 0.40, avail: 0.15, fix: 0.05, bal: 0.15, diff: 0.25 };

/** The same five sub scores scoreSquad() computes (sProj/sAvail/sBal/sDiff are
 *  shared verbatim between both horizons), weighted by `weights` and scored
 *  against `fixScore` — the ONE thing that differs per horizon: computeSFix()
 *  (next GW) for SEASON, computeSFixRun() (the whole run) for MONTH. Pure and
 *  deterministic, same discipline as scoreSquad(). */
export function scoreSquadForHorizon(inputs: RatingInputs, weights: HorizonWeights, fixScore: number): ScoreResult {
  const proj = computeSProj(inputs);
  const sAvail = computeSAvail(inputs);
  const sBal = computeSBal(inputs);
  const diff = computeSDiff(inputs);
  const subScores: SubScores = { sProj: proj.value, sAvail, sFix: fixScore, sBal, sDiff: diff.value };
  const score = round1(
    weights.proj * subScores.sProj + weights.avail * subScores.sAvail + weights.fix * subScores.sFix
    + weights.bal * subScores.sBal + weights.diff * subScores.sDiff,
  );
  return { score, subScores, flags: { allTemplate: diff.allTemplate }, raw: { projRaw: proj.raw, benchmark: proj.benchmark } };
}

// ── suggested move (code derived, never the model's call) ───────────────────

export interface SuggestedMove {
  outId: number; outName: string; outClub: string;
  inId: number; inName: string; inClub: string;
  position: FantasyPos; priceTenths: number; epNext: number;
}

const AVAIL_RANK: Record<string, number> = { i: 0, s: 0, u: 0, d: 1, a: 2 };

/** Ranks the XI worst first (unavailable > doubtful > low projection >
 *  lower player id, in that order) and looks for a same-position, available,
 *  affordable, club-legal replacement with a strictly higher projection. Pure
 *  — everything it needs is already in `inputs.pool`. Returns null when
 *  nothing on the bench of the market actually improves on the worst starter
 *  (acceptance criterion 3). */
export function deriveMove(inputs: RatingInputs): SuggestedMove | null {
  if (!inputs.xi.length) return null;
  const ranked = inputs.xi.slice().sort((a, b) =>
    (AVAIL_RANK[a.status] ?? 2) - (AVAIL_RANK[b.status] ?? 2)
    || (a.epNext ?? 0) - (b.epNext ?? 0)
    || a.id - b.id);
  const out = ranked[0];

  const wholeSquad = [...inputs.xi, ...inputs.bench];
  const ownedIds = new Set(wholeSquad.map((p) => p.id));
  const clubCounts = new Map<number, number>();
  for (const p of wholeSquad) clubCounts.set(p.clubId, (clubCounts.get(p.clubId) ?? 0) + 1);
  clubCounts.set(out.clubId, (clubCounts.get(out.clubId) ?? 1) - 1); // he's leaving

  const maxPrice = out.priceTenths + inputs.bankTenths;
  const candidates = inputs.pool.filter((c) =>
    c.pos === out.pos && c.status === "a" && !ownedIds.has(c.id)
    && c.priceTenths <= maxPrice
    && (clubCounts.get(c.clubId) ?? 0) + 1 <= MAX_PER_CLUB);
  candidates.sort((a, b) =>
    (b.epNext ?? 0) - (a.epNext ?? 0)
    || (a.ownershipPct ?? 0) - (b.ownershipPct ?? 0)
    || a.id - b.id);
  const best = candidates[0];
  // An unavailable starter is always worth replacing (he scores nothing if he
  // sits, however high his projection); otherwise require a higher projection.
  if (!best) return null;
  if (!(OUT_STATUSES.has(out.status) || (best.epNext ?? 0) > (out.epNext ?? 0))) return null;

  return {
    outId: out.id, outName: out.name, outClub: out.club,
    inId: best.id, inName: best.name, inClub: best.club,
    position: out.pos, priceTenths: best.priceTenths, epNext: best.epNext ?? 0,
  };
}

/** The MONTH horizon's suggested move — same filters (same position, fit,
 *  affordable, club-legal, not already owned) as deriveMove(), but ranked by
 *  fixture-RUN value instead of ep_next: the worst starter is ranked out by
 *  (availability, then run value, then ep_next), and the replacement is the
 *  legal candidate with the best run value (ep_next the tiebreak) — the pick
 *  that most improves the squad's August outlook, not its raw projection.
 *  Returns null when nothing legal actually improves on the outgoing
 *  player's run value, same "no obvious move" guarantee as deriveMove(). */
export function deriveMonthMove(inputs: RatingInputs): SuggestedMove | null {
  if (!inputs.xi.length) return null;
  const runOf = (p: RatingPlayer) => playerFixtureRunValue(p.clubId, inputs.fixtures);
  const ranked = inputs.xi.slice().sort((a, b) =>
    (AVAIL_RANK[a.status] ?? 2) - (AVAIL_RANK[b.status] ?? 2)
    || runOf(a) - runOf(b)
    || (a.epNext ?? 0) - (b.epNext ?? 0)
    || a.id - b.id);
  const out = ranked[0];

  const wholeSquad = [...inputs.xi, ...inputs.bench];
  const ownedIds = new Set(wholeSquad.map((p) => p.id));
  const clubCounts = new Map<number, number>();
  for (const p of wholeSquad) clubCounts.set(p.clubId, (clubCounts.get(p.clubId) ?? 0) + 1);
  clubCounts.set(out.clubId, (clubCounts.get(out.clubId) ?? 1) - 1); // he's leaving

  const maxPrice = out.priceTenths + inputs.bankTenths;
  const candidates = inputs.pool.filter((c) =>
    c.pos === out.pos && c.status === "a" && !ownedIds.has(c.id)
    && c.priceTenths <= maxPrice
    && (clubCounts.get(c.clubId) ?? 0) + 1 <= MAX_PER_CLUB);
  candidates.sort((a, b) =>
    runOf(b) - runOf(a)
    || (b.epNext ?? 0) - (a.epNext ?? 0)
    || a.id - b.id);
  const best = candidates[0];
  if (!best) return null;
  // An unavailable starter should ALWAYS be swappable (he scores nothing if he
  // sits, however kind his run). Otherwise require a genuinely better August run,
  // or an equal run with a higher projection — run values are coarse (0.2 steps),
  // so ties are common and would otherwise suppress an obvious upgrade.
  const outUnavailable = OUT_STATUSES.has(out.status);
  const improves = outUnavailable
    || runOf(best) > runOf(out)
    || (runOf(best) === runOf(out) && (best.epNext ?? 0) > (out.epNext ?? 0));
  if (!improves) return null;

  return {
    outId: out.id, outName: out.name, outClub: out.club,
    inId: best.id, inName: best.name, inClub: best.club,
    position: out.pos, priceTenths: best.priceTenths, epNext: best.epNext ?? 0,
  };
}

// ── bands (code derived, deterministic — replaces strength/risk pills) ──────

export type Band = "strong" | "decent" | "weak";

export interface BandedPlayer {
  id: number; name: string; pos: FantasyPos; band: Band; note: string;
}

/** ratio thresholds against the position ceiling — >=0.8 strong, >=0.6 decent,
 *  else weak, before the availability override and the fixture nudge. */
export const BAND_STRONG_RATIO = 0.8;
export const BAND_DECENT_RATIO = 0.6;

/** One band step down — strong to decent, decent to weak, weak stays weak. */
function dropOneBand(band: Band): Band {
  if (band === "strong") return "decent";
  return "weak";
}

/** One band step up — weak to decent, decent to strong, strong stays strong.
 *  Only used by the MONTH horizon's fixture-run nudge below. */
function raiseOneBand(band: Band): Band {
  if (band === "weak") return "decent";
  return "strong";
}

/** The best ep_next among `pool` players at each position — the realistic
 *  ceiling every band ratio is measured against. Shared by bandPlayers() and
 *  both horizon variants below so the three never drift on what "ceiling"
 *  means. */
function posCeilingMap(pool: RatingPlayer[]): Map<FantasyPos, number> {
  const posCeiling = new Map<FantasyPos, number>();
  for (const pos of ["GK", "DEF", "MID", "FWD"] as FantasyPos[]) {
    let best = -Infinity;
    for (const p of pool) if (p.pos === pos) best = Math.max(best, p.epNext ?? 0);
    if (best !== -Infinity) posCeiling.set(pos, best);
  }
  return posCeiling;
}

/** Steps 1-4 of the banding rule, shared by bandPlayers() (kept exactly as it
 *  was) and both horizon variants: position-ceiling ratio -> base band and
 *  note, then the availability override (unavailable always wins to weak; a
 *  doubt drops one step). Fixture nudges are each caller's own step 5, since
 *  SEASON skips it and MONTH nudges on the run rather than the next GW. */
function baseBandedPlayer(
  p: RatingPlayer, posCeiling: Map<FantasyPos, number>,
): { band: Band; note: string; unavailable: boolean; doubt: boolean } {
  const ep = p.epNext ?? 0;
  const ceiling = posCeiling.get(p.pos) ?? ep;
  const ratio = ceiling <= 0 ? 0 : ep / ceiling;
  let band: Band = ratio >= BAND_STRONG_RATIO ? "strong" : ratio >= BAND_DECENT_RATIO ? "decent" : "weak";
  let note = `projected ${round1(ep)}`;

  const unavailable = OUT_STATUSES.has(p.status);
  const doubt = !unavailable && (p.status === "d" || (p.chance !== null && p.chance < AVAIL_CHANCE_FLOOR));

  if (unavailable) {
    band = "weak";
    note = "unavailable";
  } else if (doubt) {
    band = dropOneBand(band);
    note = `a doubt, projected ${round1(ep)}`;
  }

  return { band, note, unavailable, doubt };
}

/** Groups the XI into strong/decent/weak, one BandedPlayer per starter, in the
 *  XI's given order. Pure and deterministic, same discipline as scoreSquad():
 *
 *  1. Position ceiling: the best ep_next among `inputs.pool` players of the
 *     SAME position (the realistic top for that slot). No pool player at that
 *     position -> fall back to the player's own ep_next.
 *  2. ratio = epNext / ceiling (ceiling <= 0 is guarded to ratio 0, never a
 *     divide-by-zero).
 *  3. Base band from the ratio thresholds above, base note "projected N".
 *  4. Availability override (takes precedence over the ratio band): unavailable
 *     (i/s/u) forces "weak" with note "unavailable"; a doubt (status d, or a
 *     sub-75% chance) drops the base band one step with an "a doubt" note.
 *  5. Fixture nudge — only when available and not already a doubt: a tough
 *     next fixture drops one more band and appends to the note; a kind fixture
 *     appends to the note when the band isn't already "strong". An empty
 *     fixtures map is the same "we don't trust this batch" signal as
 *     computeSFix() uses, so it nudges nothing.
 *
 *  Kept exactly as it was before the two-horizon rework — unchanged behaviour,
 *  still exercised by its own unit tests. bandPlayersSeason()/bandPlayersMonth()
 *  below share steps 1-4 (baseBandedPlayer) but replace step 5. */
export function bandPlayers(inputs: RatingInputs): BandedPlayer[] {
  const posCeiling = posCeilingMap(inputs.pool);

  return inputs.xi.map((p) => {
    const base = baseBandedPlayer(p, posCeiling);
    let band = base.band;
    let note = base.note;

    if (!base.unavailable && !base.doubt) {
      const cell = inputs.fixtures[p.clubId]?.[0];
      if (cell?.difficulty === "tough") {
        band = dropOneBand(band);
        note += ", tough opponent";
      } else if (cell?.difficulty === "kind" && band !== "strong") {
        note += ", kind fixture";
      }
    }

    return { id: p.id, name: p.name, pos: p.pos, band, note };
  });
}

/** SEASON horizon bands: steps 1-4 only (position-ceiling ratio, availability
 *  override) — deliberately NO fixture nudge. A single gameweek's fixture is
 *  not a season-long signal, so the season band reflects fitness and raw
 *  projection alone. Same thresholds, same availability rule as bandPlayers(). */
export function bandPlayersSeason(inputs: RatingInputs): BandedPlayer[] {
  const posCeiling = posCeilingMap(inputs.pool);
  return inputs.xi.map((p) => {
    const { band, note } = baseBandedPlayer(p, posCeiling);
    return { id: p.id, name: p.name, pos: p.pos, band, note };
  });
}

/** How decisively a fixture run has to lean before it moves a band — a run
 *  value at or past this magnitude is "clearly" kind or tough, not a wash. */
export const RUN_NUDGE_THRESHOLD = 0.5;

/** MONTH horizon bands: steps 1-4 (baseBandedPlayer), then a fixture-RUN nudge
 *  instead of bandPlayers()'s next-GW nudge — a clearly kind run
 *  (playerFixtureRunValue >= RUN_NUDGE_THRESHOLD) bumps the band UP one step; a
 *  clearly tough run (<= -RUN_NUDGE_THRESHOLD) bumps it DOWN one step. The
 *  availability override still wins outright (an unavailable or doubtful
 *  player is never nudged by fixtures). Same empty-map "don't trust this
 *  batch" guard as computeSFixRun(). */
export function bandPlayersMonth(inputs: RatingInputs): BandedPlayer[] {
  const posCeiling = posCeilingMap(inputs.pool);
  const trustFixtures = Object.keys(inputs.fixtures).length > 0;

  return inputs.xi.map((p) => {
    const base = baseBandedPlayer(p, posCeiling);
    let band = base.band;
    let note = base.note;

    if (!base.unavailable && !base.doubt && trustFixtures) {
      const runValue = playerFixtureRunValue(p.clubId, inputs.fixtures);
      if (runValue >= RUN_NUDGE_THRESHOLD) {
        band = raiseOneBand(band);
        note += ", kind run through August";
      } else if (runValue <= -RUN_NUDGE_THRESHOLD) {
        band = dropOneBand(band);
        note += ", tough run";
      }
    }

    return { id: p.id, name: p.name, pos: p.pos, band, note };
  });
}

/** Splits banded players into their three groups, preserving XI order within
 *  each. Pure. */
export function groupBands(banded: BandedPlayer[]): { strong: BandedPlayer[]; decent: BandedPlayer[]; weak: BandedPlayer[] } {
  return {
    strong: banded.filter((b) => b.band === "strong"),
    decent: banded.filter((b) => b.band === "decent"),
    weak: banded.filter((b) => b.band === "weak"),
  };
}

// ── the closed payload the model may speak from ─────────────────────────────

export interface RatingFacts {
  score: number;
  subScores: { name: string; value: number; meaning: string }[];
  bands: { name: string; pos: string; band: Band; note: string }[];
  captain: { name: string; epNext: number | null };
  projectedPoints: number;
  benchmark: number;
  bankM: number;
  suggestedMove: { out: string; in: string; position: string; priceM: number; epNext: number } | null;
  gameweek: number;
}

/** The facts the model is allowed to speak from — nothing else exists to it.
 *  groundRatingCopy() also treats this as the ONLY source of truth for prose
 *  validation, same pattern as pickFacts()/tipFacts(). `banded` is ALL 11 XI
 *  players (bandPlayers() output) so the verdict can cite any of them —
 *  including a captain who sits in a weaker band than a teammate. */
export function ratingFacts(
  inputs: RatingInputs, result: ScoreResult, move: SuggestedMove | null, banded: BandedPlayer[],
): RatingFacts {
  const captain = inputs.xi.find((p) => p.id === inputs.captainId);
  return {
    score: result.score,
    subScores: [
      { name: "projection", value: result.subScores.sProj, meaning: "how many points your XI is projected, captain counted twice" },
      { name: "availability", value: result.subScores.sAvail, meaning: "how fit and available your XI and bench are" },
      { name: "fixtures", value: result.subScores.sFix, meaning: "how kind your XI's next fixtures are" },
      { name: "balance", value: result.subScores.sBal, meaning: "how much of your budget sits unused in the bank" },
      { name: "differentials", value: result.subScores.sDiff, meaning: "how many low ownership picks are projected to score" },
    ],
    bands: banded.map(({ name, pos, band, note }) => ({ name, pos, band, note })),
    captain: { name: captain?.name ?? "no one set", epNext: captain?.epNext ?? null },
    projectedPoints: Math.round(result.raw.projRaw),
    benchmark: Math.round(result.raw.benchmark),
    bankM: Math.round((inputs.bankTenths / 10) * 10) / 10,
    suggestedMove: move
      ? { out: move.outName, in: move.inName, position: move.position, priceM: Math.round((move.priceTenths / 10) * 10) / 10, epNext: move.epNext }
      : null,
    gameweek: inputs.gameweek,
  };
}

/** The shape ratingFacts()'s (and horizonFacts()'s) `suggestedMove` field
 *  takes — pulled out once so composeMoveLine() below reads either shape
 *  without a duplicate inline type. */
type SuggestedMoveFacts = { out: string; in: string; position: string; priceM: number; epNext: number } | null;

// ── the two-horizon closed payload (RatingFacts above is kept as-is for its
//    own tests; this is the shape the two-horizon flow actually uses) ───────

export type Horizon = "month" | "season";

/** Same shape as RatingFacts, plus the horizon identity itself (`horizon`,
 *  `horizonLabel`, `objective`) — those three fields exist so the literal
 *  words "month"/"season"/"August"/"whole season" are IN the payload the
 *  grounding gate walks (collectPayloadTokens), letting a verdict use them
 *  without tripping the CLAIM_TERMS "season" gate in tips.ts. */
export interface HorizonFacts {
  horizon: Horizon;
  horizonLabel: string;
  objective: string;
  score: number;
  subScores: { name: string; value: number; meaning: string }[];
  bands: { name: string; pos: string; band: Band; note: string }[];
  captain: { name: string; epNext: number | null };
  projectedPoints: number;
  benchmark: number;
  bankM: number;
  suggestedMove: SuggestedMoveFacts;
  gameweek: number;
}

/** Facts payload both verdicts are grounded against together (see
 *  groundHorizonCopy()) — carries both horizons so a MONTH verdict can be
 *  validated against vocabulary the SEASON facts introduced and vice versa,
 *  same "one shared token pool" approach tips.ts uses for a single field. */
export interface CombinedRatingFacts {
  month: HorizonFacts;
  season: HorizonFacts;
}

const FIX_MEANING: Record<Horizon, string> = {
  month: "how kind your XI's run of fixtures through August is",
  season: "how kind your XI's next fixture is",
};

/** Builds one horizon's closed payload — the model may only rephrase what is
 *  in here, exactly the ratingFacts() discipline, extended with the
 *  horizon identity fields described above. */
export function horizonFacts(
  horizon: Horizon, inputs: RatingInputs, result: ScoreResult, move: SuggestedMove | null, banded: BandedPlayer[],
): HorizonFacts {
  const captain = inputs.xi.find((p) => p.id === inputs.captainId);
  return {
    horizon,
    horizonLabel: horizon === "month" ? "This month" : "Season",
    objective: horizon === "month" ? "the August competition" : "the whole season",
    score: result.score,
    subScores: [
      { name: "projection", value: result.subScores.sProj, meaning: "how many points your XI is projected, captain counted twice" },
      { name: "availability", value: result.subScores.sAvail, meaning: "how fit and available your XI and bench are" },
      { name: "fixtures", value: result.subScores.sFix, meaning: FIX_MEANING[horizon] },
      { name: "balance", value: result.subScores.sBal, meaning: "how much of your budget sits unused in the bank" },
      { name: "differentials", value: result.subScores.sDiff, meaning: "how many low ownership picks are projected to score" },
    ],
    bands: banded.map(({ name, pos, band, note }) => ({ name, pos, band, note })),
    captain: { name: captain?.name ?? "no one set", epNext: captain?.epNext ?? null },
    projectedPoints: Math.round(result.raw.projRaw),
    benchmark: Math.round(result.raw.benchmark),
    bankM: Math.round((inputs.bankTenths / 10) * 10) / 10,
    suggestedMove: move
      ? { out: move.outName, in: move.inName, position: move.position, priceM: Math.round((move.priceTenths / 10) * 10) / 10, epNext: move.epNext }
      : null,
    gameweek: inputs.gameweek,
  };
}

// ── mechanical templates (deterministic, from ratingFacts only) ─────────────

/** One or two plain, tense-free sentences per score band. Dash free and under
 *  three sentence terminators, same lint the model's verdict must clear. */
export function composeTemplatedVerdict(score: number): string {
  if (score >= 8) return "A strong squad, with few weak spots to worry about.";
  if (score >= 6.5) return "A solid squad, with a couple of things worth watching.";
  if (score >= 5) return "A mixed squad, some strong picks alongside a few question marks.";
  if (score >= 3) return "A shaky squad, worth a look before the deadline.";
  return "A tough squad, with several issues worth weighing up.";
}

/** The horizon-aware fallback template composeHorizonCopy() below reaches for
 *  when a verdict fails grounding — same band thresholds and dash-free, one-
 *  or-two-sentence discipline as composeTemplatedVerdict() above, but each
 *  line names its own horizon instead of speaking generically about "the
 *  squad". composeTemplatedVerdict() itself is untouched (kept for its own
 *  tests and as the single-horizon fallback shape). */
export function composeTemplatedHorizonVerdict(score: number, horizon: Horizon): string {
  if (horizon === "month") {
    if (score >= 8) return "Your August fixtures line up well, with few weak spots to worry about.";
    if (score >= 6.5) return "A kind month ahead, with a couple of things worth watching.";
    if (score >= 5) return "A mixed month ahead, some strong picks alongside a few question marks.";
    if (score >= 3) return "A tough run through August, worth a look before the deadline.";
    return "A tough month ahead, with several issues worth weighing up.";
  }
  if (score >= 8) return "A squad to hold with confidence, and few weak spots to worry about.";
  if (score >= 6.5) return "A squad to hold, with a couple of things worth watching over the season.";
  if (score >= 5) return "A squad with lasting value, some strong picks alongside a few question marks.";
  if (score >= 3) return "A squad worth rebuilding as the season goes on.";
  return "A squad with real issues to address over the season.";
}

function composeMoveLine(move: SuggestedMoveFacts): string {
  if (!move) return "No obvious move, your fifteen holds up.";
  return `Consider ${move.in} in place of ${move.out}, who projects higher.`;
}

// ── no-dash copy lint ───────────────────────────────────────────────────────
//    The founder's rule (and the ux-walk copy gate) is "no em dashes, en dashes
//    or double hyphens" — dash-as-punctuation. A PLAIN hyphen inside a real name
//    or compound (Alexander-Arnold, Ward-Prowse, top-half) is not that and must
//    pass: rejecting it forced every hyphen-named squad onto the mechanical
//    fallback while the mechanical lines printed the same hyphen anyway.

// Figure dash, en dash, em dash, horizontal bar (U+2012–U+2015), or a double
// hyphen used as an em-dash substitute. U+2010/U+2011 (ordinary hyphens) are
// treated like the ASCII "-" and allowed.
const DASH_RE = /[‒–—―]|--/;

/** True iff `text` has no em/en dash and no double hyphen (a plain hyphen inside
 *  a name or compound is allowed). */
export function lintRatingCopy(text: string): boolean {
  return !DASH_RE.test(text);
}

// ── grounding (reuses tips.ts, does not re-implement it) ────────────────────

export interface ModelRatingOutput { verdict: string }
export interface GroundedRatingCopy { verdict: string | null }

/** Ground the model's verdict against ratingFacts(). Pure — unit-testable
 *  without touching the API, same shape as tips.ts's groundTips() and
 *  scoutPicks.ts's groundPickCopy(). The verdict is dropped (null) rather than
 *  crashing anything if it fails — the caller pads the gap with the
 *  mechanical template. It additionally fails if it runs past two sentences:
 *  this is a phone card, not a column. */
export function groundRatingCopy(out: ModelRatingOutput, facts: RatingFacts): GroundedRatingCopy {
  const base = collectPayloadTokens(facts);
  const words = new Set<string>();
  base.words.forEach((w) => words.add(w));
  // The tiny template vocabulary the rating context licenses beyond the base
  // payload — none of it is a fabrication vector (no proper noun, no claim).
  ["fpl", "squad", "bench", "bank"].forEach((w) => words.add(w));
  const tokens = { words, numbers: base.numbers };
  const safe = (text: string) => isProseGrounded(text, tokens) && !hasUngroundedClaim(text, words) && lintRatingCopy(text);

  const verdictClean = cleanField(out.verdict);
  const terminators = (verdictClean.match(/[.!?]+/g) ?? []).length;
  const verdict = verdictClean && terminators > 0 && terminators <= 2 && safe(verdictClean) ? verdictClean : null;

  return { verdict };
}

/** Compose the final copy: the model's verdict where it survives grounding,
 *  the mechanical template otherwise (or when there is no model output at
 *  all — no key, an API failure, or a rejected response). `copy_source` is
 *  "model" only when the verdict itself came from the model, since the
 *  verdict is the one line every rating shows. */
export function composeRatingCopy(
  facts: RatingFacts, modelOut: ModelRatingOutput | null,
): { verdict: string; moveLine: string; copySource: CopySource } {
  const mechanicalVerdict = composeTemplatedVerdict(facts.score);
  const moveLine = composeMoveLine(facts.suggestedMove);

  if (!modelOut) {
    return { verdict: mechanicalVerdict, moveLine, copySource: "mechanical" };
  }

  const grounded = groundRatingCopy(modelOut, facts);
  return {
    verdict: grounded.verdict ?? mechanicalVerdict,
    moveLine,
    copySource: grounded.verdict ? "model" : "mechanical",
  };
}

// ── two-horizon grounding + composition (one model call, two verdicts) ──────

export interface ModelHorizonOutput { monthVerdict: string; seasonVerdict: string }
export interface GroundedHorizonCopy { monthVerdict: string | null; seasonVerdict: string | null }

/** Grounds BOTH verdicts against ONE combined token pool built from both
 *  horizons' facts — the reason `facts` here is the whole CombinedRatingFacts,
 *  not one HorizonFacts at a time: a MONTH verdict may reuse a word the SEASON
 *  facts introduced (or vice versa), and critically the literal payload text
 *  ("This month"/"Season"/"the August competition"/"the whole season") is what
 *  licenses the model to use those exact words without tripping tips.ts's
 *  CLAIM_TERMS "season" gate. Otherwise identical discipline to
 *  groundRatingCopy(): isProseGrounded + hasUngroundedClaim + the no-dash lint
 *  + the two-sentence cap, applied to EACH field independently so one verdict
 *  failing never drags the other down with it. */
export function groundHorizonCopy(out: ModelHorizonOutput, facts: CombinedRatingFacts): GroundedHorizonCopy {
  const base = collectPayloadTokens(facts);
  const words = new Set<string>();
  base.words.forEach((w) => words.add(w));
  ["fpl", "squad", "bench", "bank"].forEach((w) => words.add(w));
  const tokens = { words, numbers: base.numbers };
  const safe = (text: string) => isProseGrounded(text, tokens) && !hasUngroundedClaim(text, words) && lintRatingCopy(text);

  const groundOne = (raw: string | undefined): string | null => {
    const clean = cleanField(raw);
    const terminators = (clean.match(/[.!?]+/g) ?? []).length;
    return clean && terminators > 0 && terminators <= 2 && safe(clean) ? clean : null;
  };

  return { monthVerdict: groundOne(out.monthVerdict), seasonVerdict: groundOne(out.seasonVerdict) };
}

/** Compose both horizons' final copy in one pass: the model's verdict per
 *  horizon where it survives grounding, that horizon's own templated fallback
 *  otherwise — same "never blocked on the LLM" guarantee composeRatingCopy()
 *  gives a single verdict, doubled. */
export function composeHorizonCopy(
  monthFacts: HorizonFacts, seasonFacts: HorizonFacts, modelOut: ModelHorizonOutput | null,
): {
  month: { verdict: string; moveLine: string; copySource: CopySource };
  season: { verdict: string; moveLine: string; copySource: CopySource };
} {
  const monthTemplate = composeTemplatedHorizonVerdict(monthFacts.score, "month");
  const seasonTemplate = composeTemplatedHorizonVerdict(seasonFacts.score, "season");
  const monthMoveLine = composeMoveLine(monthFacts.suggestedMove);
  const seasonMoveLine = composeMoveLine(seasonFacts.suggestedMove);

  if (!modelOut) {
    return {
      month: { verdict: monthTemplate, moveLine: monthMoveLine, copySource: "mechanical" },
      season: { verdict: seasonTemplate, moveLine: seasonMoveLine, copySource: "mechanical" },
    };
  }

  const grounded = groundHorizonCopy(modelOut, { month: monthFacts, season: seasonFacts });
  return {
    month: {
      verdict: grounded.monthVerdict ?? monthTemplate, moveLine: monthMoveLine,
      copySource: grounded.monthVerdict ? "model" : "mechanical",
    },
    season: {
      verdict: grounded.seasonVerdict ?? seasonTemplate, moveLine: seasonMoveLine,
      copySource: grounded.seasonVerdict ? "model" : "mechanical",
    },
  };
}

// ── AI copy layer (Sonnet, tool-forced — same fetch shape as tips.ts) ───────
//    ONE call writes BOTH verdicts (cost control — never two Anthropic calls
//    for one rating), grounded independently against the combined facts.

const RATING_SYSTEM = `You write two short verdicts for a YourScore fantasy
football squad rating: one for the MONTH ahead, one for the SEASON as a whole.

THE ABSOLUTE RULE
You know NOTHING about football beyond the JSON you are given. Every name, club
and number you mention MUST appear in that JSON. If it is not there, it does
not exist and you may not refer to it. Do not add context you "know".

THE SCORES ARE ALREADY DECIDED
The JSON has a "month" object and a "season" object. Each one's numeric score,
every sub score, and the strong/decent/weak band on every XI player were
computed by code before you saw them. Your job is to explain what they show in
plain words. Never argue with a score, soften it, or recompute it yourself.

WHAT MONTH AND SEASON EACH MEAN
- monthVerdict is about the month.fixtures sub score and month.bands: how the
  fixture run through August sets this squad up to win the August competition.
  Talk about the run ahead, not one single gameweek.
- seasonVerdict is about season.fixtures, season.bands and season.subScores'
  projection and differentials entries: lasting value over the whole season,
  the spine worth keeping, and any differential worth carrying long term.
- The two verdicts must read as genuinely different takes, not the same
  sentence twice. It is fine for them to agree on the same weak spot if the
  data says so twice, but say it in different words for a different reason.

IT IS PRE-SEASON
The season has not started. Every number in the JSON is a projection, not a
result. Never use phrasing that implies a match has already been played or a
matchweek is currently live. Write in a tense-free way, e.g. "projects 3.1"
rather than naming any live or current matchweek.

VOICE (both fields)
- One sentence, two at the absolute most, per field.
- No em dashes, en dashes or double hyphens anywhere in either field.
- Sound like someone who knows their football summing a friend's team up in one
  breath: plain, specific, a little dry. Understated beats hyped.
- Do NOT use the word "band". Do NOT lean on tired phrases ("bright spot",
  "dragging down", "engine room", "firepower", "on paper", "worth watching").
  No hype, no cliches. Never output JSON, quotes or braces inside either field.

DO NOT RECITE NUMBERS
The scores, sub scores, projected points and benchmark are ALREADY shown to
the reader right next to your words. Repeating them back reads like a robot.
So do NOT quote a score or any of those numbers. Say what the squad is
actually LIKE, in words: a strong spine, a thin attack, a captain who is not
your best option.

WHAT TO PRODUCE
- monthVerdict, seasonVerdict: one or two short plain sentences each, on where
  that horizon's take is strong and where it is weak. The reader can already
  see every player and their band listed below each verdict, so do NOT read
  that list back to them. Name only the ONE or TWO players who actually matter
  per field (the standout, or a captain on the wrong player), and describe
  everyone else as a GROUP, not a list of names: "a thin midfield", "not much
  behind him", "a weak back line". Never name three or more players in one
  field. If the captain is not the best pick for the armband, say so once. Say
  the single most useful thing for that horizon, then stop.`;

interface AnthropicResponse { content?: { type: string; input?: ModelHorizonOutput }[] }

/** ONE Anthropic call, tool-forced, that returns BOTH verdicts. Never throws —
 *  returns null on any failure so computeHorizonResults() falls back to each
 *  horizon's own mechanical template and still ships a full rating. */
export async function callModelForHorizons(facts: CombinedRatingFacts): Promise<ModelHorizonOutput | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.error("[squad rating] copy skipped: no ANTHROPIC_API_KEY");
    return null;
  }

  const tool = {
    name: "squad_rating_horizons",
    description: "The month and season verdicts for a fantasy squad rating.",
    input_schema: {
      type: "object",
      properties: {
        monthVerdict: { type: "string" },
        seasonVerdict: { type: "string" },
      },
      required: ["monthVerdict", "seasonVerdict"],
    },
  };

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 500,
        system: RATING_SYSTEM,
        tools: [tool],
        tool_choice: { type: "tool", name: "squad_rating_horizons" },
        messages: [{
          role: "user",
          content:
            `These are the ONLY facts that exist for this squad:\n\n${JSON.stringify(facts, null, 2)}\n\n`
            + `Write monthVerdict and seasonVerdict. Every name and number must come from that JSON.`,
        }],
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      console.error(`[squad rating] copy failed: http-${res.status}`);
      return null;
    }
    const json = (await res.json()) as AnthropicResponse;
    const block = json.content?.find((c) => c.type === "tool_use");
    if (!block?.input) {
      console.error("[squad rating] copy failed: no-tool-use-block");
      return null;
    }
    return block.input;
  } catch (e) {
    console.error("[squad rating] copy failed: exception", e);
    return null;
  }
}

// ── orchestration (impure: DB reads, the AI call, the cache write) ──────────

/** `avatarUrl` is resolved here, server-side, from `faceUrlById()` — the same
 *  real SportMonks headshot map pool.ts serves — so both the guest result
 *  screen and the member SquadRating card can show a portrait beside every
 *  banded player without a client-side lookup. `null` when we hold no photo
 *  for that id; the client falls back to faceFor(name) then the monogram. */
export interface BandCard { id: number; name: string; pos: string; note: string; avatarUrl: string | null }
export interface RatingBands { strong: BandCard[]; decent: BandCard[]; weak: BandCard[] }

/** One horizon's full result — everything a card needs to render that tab:
 *  its own score, verdict, bands and suggested move. */
export interface HorizonResult {
  score: number;
  verdict: string;
  bands: RatingBands;
  moveLine: string;
  copySource: CopySource;
  subScores: { name: string; value: number }[];
}

export interface RatingResponse {
  month: HorizonResult;
  season: HorizonResult;
  generatedAt: string;
  snapshotCutoff: string;
}

function toSubScoreList(sub: SubScores): { name: string; value: number }[] {
  return [
    { name: "projection", value: sub.sProj },
    { name: "availability", value: sub.sAvail },
    { name: "fixtures", value: sub.sFix },
    { name: "balance", value: sub.sBal },
    { name: "differentials", value: sub.sDiff },
  ];
}

type SquadRow = {
  picks: { id: number; pos: FantasyPos; clubId: number; buyTenths: number }[];
  bank_tenths: number;
  xi: number[];
  bench: number[];
  captain: number;
  vice: number;
};

type SnapRow = {
  player_id: number; team: number | null; status: string | null;
  chance_of_playing_next_round: number | null; ep_next: number | null;
  selected_by_percent: number | string | null; next_event: number | null;
};

/** `score`/`sub_scores` are still written (mirroring the MONTH horizon) purely
 *  so the DB columns stay populated for any indexing/reporting outside this
 *  file — nothing in this file reads them back; the payload is the only
 *  source of truth for shapeStoredRow(). `month`/`season` are OPTIONAL on the
 *  stored payload shape: a row written before this two-horizon rework has
 *  neither key, and shapeStoredRow() below treats that as a cache MISS
 *  (returns null) rather than trying to render a broken single-horizon shape
 *  through the new two-tab UI. */
type StoredRatingRow = {
  score: number | string;
  sub_scores: unknown;
  snapshot_cutoff: string;
  payload: {
    month?: HorizonResult;
    season?: HorizonResult;
    generatedAt: string;
  };
};

/** Returns null — a cache MISS — for a pre-rework row (no `month`/`season` on
 *  the stored payload) so every caller falls back to recomputing instead of
 *  rendering a broken shape through the two-tab UI. */
function shapeStoredRow(row: StoredRatingRow): RatingResponse | null {
  const { month, season } = row.payload;
  if (!month || !season) return null;
  return { month, season, generatedAt: row.payload.generatedAt, snapshotCutoff: row.snapshot_cutoff };
}

const num = (v: number | string | null | undefined): number | null =>
  (v === null || v === undefined ? null : Number(v));

async function loadSquadRow(db: Db, userId: string): Promise<SquadRow | null> {
  const { data } = await db.from("fantasy_squads")
    .select("picks, bank_tenths, xi, bench, captain, vice")
    .eq("user_id", userId).maybeSingle();
  return (data as SquadRow) ?? null;
}

/** Everything about "the market right now" that a rating is computed against:
 *  the latest live snapshot batch, this gameweek's priced pool, and the
 *  fixture ticker — plus `toRatingPlayer`, the one function that turns a pool
 *  id into a RatingPlayer against THIS market, so a squad-backed rating
 *  (loadRatingInputs, below) and a raw-ids guest rating (guestRating.ts) build
 *  their players identically. Returns null when there's no snapshot batch or
 *  it came back empty — the all-or-nothing "we don't trust this read" signal
 *  both callers already treat as "can't rate right now". */
export interface RatingMarket {
  gw: number;
  cutoff: string;
  fixtures: Record<number, { difficulty: Difficulty }[]>;
  toRatingPlayer: (id: number) => RatingPlayer | null;
  /** Every available (status 'a') snapshot player, priced for `gw` — the same
   *  replacement-search candidate set deriveMove() and benchmarkRaw() read. */
  poolCandidates: RatingPlayer[];
}

/** Read the latest snapshot batch, this gameweek's priced pool and one
 *  fantasyContext() fixture read. Impure (DB + the shared in-memory pool);
 *  everything downstream of the RatingMarket it returns is pure. */
export async function loadRatingMarket(db: Db): Promise<RatingMarket | null> {
  const { data: latest } = await db.from("fantasy_fpl_snapshot").select("captured_at")
    .eq("is_rehearsal", false).order("captured_at", { ascending: false }).limit(1);
  const cutoff: string | undefined = (latest as { captured_at: string }[] | null)?.[0]?.captured_at;
  if (!cutoff) return null;

  const { data: snapRows } = await db.from("fantasy_fpl_snapshot")
    .select("player_id, team, status, chance_of_playing_next_round, ep_next, selected_by_percent, next_event")
    .eq("captured_at", cutoff).eq("is_rehearsal", false).range(0, 9999);
  const snap = (snapRows ?? []) as SnapRow[];
  if (!snap.length) return null;
  const snapById = new Map(snap.map((r) => [r.player_id, r]));
  const gw = snap.find((r) => r.next_event !== null)?.next_event ?? 0;

  const pool = await pricedPool(db, gw);
  const poolById = new Map(pool.map((p) => [p.id, p]));

  const context = await fantasyContext(db);
  const fixtures = context.fixtures as unknown as Record<number, { difficulty: Difficulty }[]>;

  const toRatingPlayer = (id: number): RatingPlayer | null => {
    const p = poolById.get(id);
    if (!p) return null;
    const s = snapById.get(id);
    return {
      id, name: p.name, club: p.club, clubId: p.clubId, pos: p.pos, priceTenths: p.priceTenths,
      status: (s?.status ?? "u").trim().toLowerCase() || "u",
      chance: s?.chance_of_playing_next_round ?? null,
      epNext: num(s?.ep_next), ownershipPct: num(s?.selected_by_percent),
    };
  };

  const poolCandidates = pool
    .map((p) => toRatingPlayer(p.id))
    .filter((p): p is RatingPlayer => !!p && p.status === "a");

  return { gw, cutoff, fixtures, toRatingPlayer, poolCandidates };
}

/** Build the frozen RatingInputs for a squad row against the current market.
 *  Impure (delegates to loadRatingMarket); everything downstream is pure. */
async function loadRatingInputs(db: Db, squad: SquadRow): Promise<{ inputs: RatingInputs; cutoff: string } | null> {
  const market = await loadRatingMarket(db);
  if (!market) return null;

  const squadPlayers = squad.picks.map((pk) => market.toRatingPlayer(pk.id)).filter((p): p is RatingPlayer => !!p);
  const inputs = buildRatingInputs({
    gameweek: market.gw, squadPlayers, xiIds: squad.xi, benchIds: squad.bench,
    captainId: squad.captain, bankTenths: squad.bank_tenths, pool: market.poolCandidates, fixtures: market.fixtures,
  });
  return { inputs, cutoff: market.cutoff };
}

/** The pure(ish) core of a two-horizon rating: both horizons' scores, bands
 *  and suggested moves (all code, deterministic), then ONE model call that
 *  writes both verdicts at once. No DB I/O — computeAndStore() below wraps
 *  this with the upsert for a signed-in manager; guestRating.ts calls it
 *  directly, since a guest has nothing to cache. Exported so both call sites
 *  share one implementation rather than two that could drift. */
export async function computeHorizonResults(
  inputs: RatingInputs,
): Promise<{ month: HorizonResult; season: HorizonResult; generatedAt: string }> {
  const monthResult = scoreSquadForHorizon(inputs, MONTH_WEIGHTS, computeSFixRun(inputs));
  const seasonResult = scoreSquadForHorizon(inputs, SEASON_WEIGHTS, computeSFix(inputs));

  const monthMove = deriveMonthMove(inputs);
  const seasonMove = deriveMove(inputs);

  const monthBanded = bandPlayersMonth(inputs);
  const seasonBanded = bandPlayersSeason(inputs);
  const monthGrouped = groupBands(monthBanded);
  const seasonGrouped = groupBands(seasonBanded);

  const monthFacts = horizonFacts("month", inputs, monthResult, monthMove, monthBanded);
  const seasonFacts = horizonFacts("season", inputs, seasonResult, seasonMove, seasonBanded);

  const modelOut = await callModelForHorizons({ month: monthFacts, season: seasonFacts });
  const copy = composeHorizonCopy(monthFacts, seasonFacts, modelOut);

  const toCard = (b: BandedPlayer): BandCard =>
    ({ id: b.id, name: b.name, pos: b.pos, note: b.note, avatarUrl: faceUrlById(b.id) ?? null });
  const bandsOf = (g: { strong: BandedPlayer[]; decent: BandedPlayer[]; weak: BandedPlayer[] }): RatingBands =>
    ({ strong: g.strong.map(toCard), decent: g.decent.map(toCard), weak: g.weak.map(toCard) });

  const generatedAt = new Date().toISOString();
  return {
    month: {
      score: monthResult.score, verdict: copy.month.verdict, bands: bandsOf(monthGrouped),
      moveLine: copy.month.moveLine, copySource: copy.month.copySource, subScores: toSubScoreList(monthResult.subScores),
    },
    season: {
      score: seasonResult.score, verdict: copy.season.verdict, bands: bandsOf(seasonGrouped),
      moveLine: copy.season.moveLine, copySource: copy.season.copySource, subScores: toSubScoreList(seasonResult.subScores),
    },
    generatedAt,
  };
}

/** Compute a full two-horizon rating and upsert it onto (user_id,
 *  squad_hash). One model call per call to this function — the cache logic in
 *  rateSquad() decides WHEN to call it. */
async function computeAndStore(db: Db, userId: string, hash: string, inputs: RatingInputs, cutoff: string): Promise<RatingResponse> {
  const { month, season, generatedAt } = await computeHorizonResults(inputs);

  const row = {
    user_id: userId,
    squad_hash: hash,
    score: month.score,
    sub_scores: month.subScores,
    payload: { month, season, generatedAt },
    snapshot_cutoff: cutoff,
  };
  const { data: saved, error } = await db.from("fantasy_squad_rating")
    .upsert(row, { onConflict: "user_id,squad_hash" })
    .select("score, sub_scores, snapshot_cutoff, payload")
    .maybeSingle();
  if (error) throw new Error(error.message);
  // The row we just built is always a valid two-horizon shape, so this can
  // only be null if the DB echoed something unexpected back — fall back to
  // the in-memory row rather than surface that as a broken response.
  return shapeStoredRow((saved as StoredRatingRow) ?? (row as unknown as StoredRatingRow))
    ?? { month, season, generatedAt, snapshotCutoff: cutoff };
}

/** GET (peek): return the stored rating for the CURRENT squad hash, or null.
 *  NEVER computes and NEVER calls the model — acceptance criterion 7. */
export async function peekSquadRating(db: Db, userId: string): Promise<{ noSquad: boolean; rating: RatingResponse | null }> {
  const squad = await loadSquadRow(db, userId);
  if (!squad || squad.picks.length !== 15) return { noSquad: true, rating: null };

  const hash = squadHash(squad.picks, squad.xi, squad.bench, squad.captain, squad.vice);
  const { data: existing } = await db.from("fantasy_squad_rating")
    .select("score, sub_scores, snapshot_cutoff, payload")
    .eq("user_id", userId).eq("squad_hash", hash).maybeSingle();
  if (!existing) return { noSquad: false, rating: null };
  // A pre-rework row (no month/season on the payload) shapes to null — the
  // peek behaves exactly like "not rated yet" rather than crashing the UI on
  // a stale shape. peekSquadRating() NEVER computes, so this is the one path
  // that can legitimately hand back { rating: null } for an existing row.
  return { noSquad: false, rating: shapeStoredRow(existing as StoredRatingRow) };
}

/** The most recent snapshot batch's timestamp, or null if there is none. Cheap
 *  (one indexed row) — used to decide whether a cached rating predates fresh
 *  availability/price data and should be recomputed. */
async function latestSnapshotCutoff(db: Db): Promise<string | null> {
  const { data } = await db.from("fantasy_fpl_snapshot").select("captured_at")
    .eq("is_rehearsal", false).order("captured_at", { ascending: false }).limit(1);
  return (data as { captured_at: string }[] | null)?.[0]?.captured_at ?? null;
}

/** Draw one token from the per-user daily compute budget. Returns false when the
 *  budget is spent — the caller then serves the last stored rating (still honest,
 *  the card shows its "as of" time) or, on a brand-new squad, refuses politely. */
async function consumeComputeBudget(userId: string): Promise<boolean> {
  const rl = await rateLimitDistributed(`fantasy:squad-rating:compute:${userId}`, DAILY_COMPUTE_CAP, DAY_MS);
  return rl.ok;
}

/** POST: rate the manager's current squad. A cache hit (same hash, no `fresh`)
 *  returns the stored row with zero model calls, UNLESS a newer snapshot has
 *  landed since it was written (fresh injuries/prices) and the daily compute
 *  budget allows one recompute. `{fresh:true}` always recomputes (3/day). Every
 *  ACTUAL compute — fresh, a stale-snapshot refresh, or a brand-new hash miss —
 *  draws the daily compute budget, which is the cost guard against captain/XI
 *  shuffling minting unlimited billed hashes. The route turns
 *  SquadRatingRateLimitError into a 429. */
export async function rateSquad(
  db: Db, userId: string, opts: { fresh?: boolean } = {},
): Promise<{ noSquad: true } | { noSquad: false; rating: RatingResponse }> {
  const squad = await loadSquadRow(db, userId);
  if (!squad || squad.picks.length !== 15) return { noSquad: true };

  const hash = squadHash(squad.picks, squad.xi, squad.bench, squad.captain, squad.vice);

  if (opts.fresh) {
    const rl = await rateLimitDistributed(`fantasy:squad-rating:fresh:${userId}`, 3, DAY_MS);
    if (!rl.ok) throw new SquadRatingRateLimitError("Three fresh takes a day is the limit, friend. Try again tomorrow.");
  } else {
    const { data: existing } = await db.from("fantasy_squad_rating")
      .select("score, sub_scores, snapshot_cutoff, payload")
      .eq("user_id", userId).eq("squad_hash", hash).maybeSingle();
    if (existing) {
      const stored = shapeStoredRow(existing as StoredRatingRow);
      if (stored) {
        // Serve the cache unless a newer snapshot exists AND we can afford one
        // recompute. Short-circuit means the budget is only drawn when we actually
        // recompute; otherwise the stored take (with its "as of" time) is served.
        const latest = await latestSnapshotCutoff(db);
        if (!latest || latest <= stored.snapshotCutoff || !(await consumeComputeBudget(userId))) {
          return { noSquad: false, rating: stored };
        }
        const loaded = await loadRatingInputs(db, squad);
        if (!loaded) return { noSquad: false, rating: stored };
        return { noSquad: false, rating: await computeAndStore(db, userId, hash, loaded.inputs, loaded.cutoff) };
      }
      // A pre-rework, single-horizon row for this hash — the same "we don't
      // trust this shape" signal as a miss. Fall through to the genuine
      // compute below, which draws the daily budget like any other miss.
    }
  }

  // A genuine compute: a fresh recompute, or a brand-new hash miss. Bound cost.
  if (!(await consumeComputeBudget(userId))) {
    throw new SquadRatingRateLimitError("You have had plenty of squad takes today, friend. Try again tomorrow.");
  }
  const loaded = await loadRatingInputs(db, squad);
  if (!loaded) throw new Error("no fpl snapshot available to rate against");
  const rating = await computeAndStore(db, userId, hash, loaded.inputs, loaded.cutoff);
  return { noSquad: false, rating };
}
