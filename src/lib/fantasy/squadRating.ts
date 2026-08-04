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
  if (!best || (best.epNext ?? 0) <= (out.epNext ?? 0)) return null;

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
 *     computeSFix() uses, so it nudges nothing. */
export function bandPlayers(inputs: RatingInputs): BandedPlayer[] {
  const posCeiling = new Map<FantasyPos, number>();
  for (const pos of ["GK", "DEF", "MID", "FWD"] as FantasyPos[]) {
    let best = -Infinity;
    for (const p of inputs.pool) if (p.pos === pos) best = Math.max(best, p.epNext ?? 0);
    if (best !== -Infinity) posCeiling.set(pos, best);
  }

  return inputs.xi.map((p) => {
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

    if (!unavailable && !doubt) {
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

function composeMoveLine(move: RatingFacts["suggestedMove"]): string {
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

// ── AI copy layer (Sonnet, tool-forced — same fetch shape as tips.ts) ───────

const RATING_SYSTEM = `You write a short verdict for a YourScore fantasy
football squad rating.

THE ABSOLUTE RULE
You know NOTHING about football beyond the JSON you are given. Every name, club
and number you mention MUST appear in that JSON. If it is not there, it does
not exist and you may not refer to it. Do not add context you "know".

THE SCORE IS ALREADY DECIDED
The numeric score, every sub score, and the strong/decent/weak band on every
XI player in the JSON were computed by code before you saw them. Your job is
to explain what they show in plain words. Never argue with the score, soften
it, or recompute it yourself.

IT IS PRE-SEASON
The season has not started. Every number in the JSON is a projection, not a
result. Never use phrasing that implies a match has already been played or a
matchweek is currently live. Write in a tense-free way, e.g. "projects 3.1"
rather than naming any live or current matchweek.

VOICE
- One sentence, two at the absolute most.
- No em dashes, en dashes or double hyphens anywhere in the field.
- Sound like someone who knows their football summing a friend's team up in one
  breath: plain, specific, a little dry. Understated beats hyped.
- Do NOT use the word "band". Do NOT lean on tired phrases ("bright spot",
  "dragging down", "engine room", "firepower", "on paper", "worth watching").
  No hype, no cliches. Never output JSON, quotes or braces inside the field.

DO NOT RECITE NUMBERS
The score, the sub scores, the projected points and the benchmark are ALREADY
shown to the reader right next to your words. Repeating them back reads like a
robot. So do NOT quote the score or any of those numbers. Say what the squad is
actually LIKE, in words: a strong spine, a thin attack, a captain who is not
your best option.

WHAT TO PRODUCE
- verdict: one or two short plain sentences on where this squad is strong and
  where it is weak. The reader can already see every player and their band
  listed below your verdict, so do NOT read that list back to them. Name only
  the ONE or TWO players who actually matter (the standout, or a captain on the
  wrong player), and describe everyone else as a GROUP, not a list of names: "a
  thin midfield", "not much behind him", "a weak back line". Never name three or
  more players. If the captain is not the best pick for the armband, say so. Say
  the single most useful thing about this team, then stop.`;

interface AnthropicResponse { content?: { type: string; input?: ModelRatingOutput }[] }

/** Ask the model to rephrase ratingFacts() into a verdict. Never throws —
 *  returns null on any failure so rateSquad() can fall back to the mechanical
 *  template and still ship a full rating. */
export async function callModelForRating(facts: RatingFacts): Promise<ModelRatingOutput | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.error("[squad rating] copy skipped: no ANTHROPIC_API_KEY");
    return null;
  }

  const tool = {
    name: "squad_rating",
    description: "The verdict for a fantasy squad rating.",
    input_schema: {
      type: "object",
      properties: {
        verdict: { type: "string" },
      },
      required: ["verdict"],
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
        max_tokens: 400,
        system: RATING_SYSTEM,
        tools: [tool],
        tool_choice: { type: "tool", name: "squad_rating" },
        messages: [{
          role: "user",
          content:
            `These are the ONLY facts that exist for this squad:\n\n${JSON.stringify(facts, null, 2)}\n\n`
            + `Write the verdict. Every name and number must come from that JSON.`,
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

export interface RatingResponse {
  score: number;
  verdict: string;
  bands: RatingBands;
  moveLine: string;
  copySource: CopySource;
  subScores: { name: string; value: number }[];
  gameweek: number;
  generatedAt: string;
  snapshotCutoff: string;
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

/** `bands` is optional on the stored payload shape so a row written before
 *  this rework (no `bands` key) never crashes shapeStoredRow — it defaults to
 *  three empty groups instead. */
type StoredRatingRow = {
  score: number | string;
  sub_scores: SubScores;
  snapshot_cutoff: string;
  payload: {
    verdict: string; bands?: RatingBands; moveLine: string;
    copySource: CopySource; gameweek: number; generatedAt: string;
  };
};

const EMPTY_BANDS: RatingBands = { strong: [], decent: [], weak: [] };

function shapeStoredRow(row: StoredRatingRow): RatingResponse {
  const sub = row.sub_scores;
  return {
    score: Number(row.score),
    verdict: row.payload.verdict,
    bands: row.payload.bands ?? EMPTY_BANDS,
    moveLine: row.payload.moveLine,
    copySource: row.payload.copySource,
    subScores: [
      { name: "projection", value: sub.sProj },
      { name: "availability", value: sub.sAvail },
      { name: "fixtures", value: sub.sFix },
      { name: "balance", value: sub.sBal },
      { name: "differentials", value: sub.sDiff },
    ],
    gameweek: row.payload.gameweek,
    generatedAt: row.payload.generatedAt,
    snapshotCutoff: row.snapshot_cutoff,
  };
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

/** Compute a full rating (score, verdict, bands, move), calling the model
 *  once, and upsert it onto (user_id, squad_hash). One model call per call to
 *  this function — the cache logic in rateSquad() decides WHEN to call it. */
async function computeAndStore(db: Db, userId: string, hash: string, inputs: RatingInputs, cutoff: string): Promise<RatingResponse> {
  const result = scoreSquad(inputs);
  const move = deriveMove(inputs);
  const banded = bandPlayers(inputs);
  const grouped = groupBands(banded);
  const facts = ratingFacts(inputs, result, move, banded);

  const modelOut = await callModelForRating(facts);
  const copy = composeRatingCopy(facts, modelOut);

  const toCard = (b: BandedPlayer): BandCard =>
    ({ id: b.id, name: b.name, pos: b.pos, note: b.note, avatarUrl: faceUrlById(b.id) ?? null });
  const bands: RatingBands = {
    strong: grouped.strong.map(toCard),
    decent: grouped.decent.map(toCard),
    weak: grouped.weak.map(toCard),
  };

  const generatedAt = new Date().toISOString();
  const row = {
    user_id: userId,
    squad_hash: hash,
    score: result.score,
    sub_scores: result.subScores,
    payload: {
      verdict: copy.verdict, bands, moveLine: copy.moveLine,
      copySource: copy.copySource, gameweek: inputs.gameweek, generatedAt,
    },
    snapshot_cutoff: cutoff,
  };
  const { data: saved, error } = await db.from("fantasy_squad_rating")
    .upsert(row, { onConflict: "user_id,squad_hash" })
    .select("score, sub_scores, snapshot_cutoff, payload")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return shapeStoredRow((saved as StoredRatingRow) ?? (row as unknown as StoredRatingRow));
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
