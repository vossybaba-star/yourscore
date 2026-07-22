/**
 * YourScore Fantasy Football — pure game engine. No DB, no Date, no fetch, no
 * randomness: everything here is a deterministic function of its inputs, so the
 * whole rule surface is unit-testable (scripts/fantasy/run-tests.sh) and scoring
 * re-runs are idempotent by construction.
 *
 * Money is INTEGER TENTHS of £m throughout (£100.0m = 1000) — no float drift.
 * Rules per docs/your-pl-xi-design.md (founder-locked 10 Jul defaults).
 */

import { type FantasyPos, type MatchFacts, ZERO_FACTS, pointsFor } from "./values";

// ── Constants (validated defaults) ───────────────────────────────────────────
export const BUDGET_TENTHS = 1000; // £100.0m
export const SQUAD_QUOTA: Record<FantasyPos, number> = { GK: 2, DEF: 5, MID: 5, FWD: 3 };
export const SQUAD_SIZE = 15;
export const XI_SIZE = 11;
export const MAX_PER_CLUB = 3;
export const CREDIT_CAP = 5;
export const HIT_POINTS = 4;
/** Cashing a credit pays what buying a transfer costs — the economy is symmetric:
 *  knowledge buys transfers or points, points buy transfers (founder, 14 Jul). */
export const CASH_POINTS = HIT_POINTS;

export interface PoolPlayer {
  id: number;        // pool id (= FPL element id)
  smId: number | null; // SportMonks player id, baked at pool build
  name: string;
  club: string;
  clubId: number;
  pos: FantasyPos;
  priceTenths: number;
}

export interface SquadPick { id: number; pos: FantasyPos; clubId: number; buyTenths: number }
export interface Squad { picks: SquadPick[]; bankTenths: number }
export interface Selection { xi: number[]; bench: number[]; captain: number; vice: number }
export interface LockedSelection extends Selection { picks: SquadPick[] }

export class RuleError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

const byId = (pool: PoolPlayer[]) => new Map(pool.map((p) => [p.id, p]));

// ── Squad validation ──────────────────────────────────────────────────────────
/** Validate a 15-man squad; prices ALWAYS come from the pool, never the caller. */
export function validateSquad(pickIds: number[], pool: PoolPlayer[], budgetTenths = BUDGET_TENTHS): Squad {
  if (pickIds.length !== SQUAD_SIZE) throw new RuleError("size", `squad must be ${SQUAD_SIZE} players`);
  if (new Set(pickIds).size !== SQUAD_SIZE) throw new RuleError("dup", "duplicate players");
  const index = byId(pool);
  const picks: SquadPick[] = [];
  const posCount: Record<FantasyPos, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  const clubCount = new Map<number, number>();
  let spent = 0;
  for (const id of pickIds) {
    const p = index.get(id);
    if (!p) throw new RuleError("unknown", `unknown player id ${id}`);
    posCount[p.pos]++;
    clubCount.set(p.clubId, (clubCount.get(p.clubId) ?? 0) + 1);
    spent += p.priceTenths;
    picks.push({ id: p.id, pos: p.pos, clubId: p.clubId, buyTenths: p.priceTenths });
  }
  for (const pos of Object.keys(SQUAD_QUOTA) as FantasyPos[])
    if (posCount[pos] !== SQUAD_QUOTA[pos])
      throw new RuleError("quota", `need ${SQUAD_QUOTA[pos]} ${pos}, got ${posCount[pos]}`);
  for (const [clubId, n] of Array.from(clubCount))
    if (n > MAX_PER_CLUB) throw new RuleError("club", `more than ${MAX_PER_CLUB} players from club ${clubId}`);
  if (spent > budgetTenths) throw new RuleError("budget", `squad costs £${spent / 10}m > £${budgetTenths / 10}m`);
  return { picks, bankTenths: budgetTenths - spent };
}

// ── Selection (XI + bench + armband) validation ───────────────────────────────
/** XI legality: exactly 1 GK, ≥3 DEF, ≥1 FWD, 11 total; bench[0] is the GK. */
export function validateSelection(squad: Squad, xi: number[], bench: number[], captain: number, vice: number): Selection {
  const squadIds = new Set(squad.picks.map((p) => p.id));
  const all = [...xi, ...bench];
  if (xi.length !== XI_SIZE || bench.length !== SQUAD_SIZE - XI_SIZE)
    throw new RuleError("shape", "need 11 starters + 4 bench");
  if (new Set(all).size !== SQUAD_SIZE || !all.every((id) => squadIds.has(id)))
    throw new RuleError("membership", "XI + bench must be exactly your 15 picks");
  const posOf = new Map(squad.picks.map((p) => [p.id, p.pos]));
  const count = (ids: number[], pos: FantasyPos) => ids.filter((id) => posOf.get(id) === pos).length;
  if (count(xi, "GK") !== 1) throw new RuleError("formation", "XI needs exactly 1 GK");
  if (count(xi, "DEF") < 3) throw new RuleError("formation", "XI needs at least 3 DEF");
  if (count(xi, "FWD") < 1) throw new RuleError("formation", "XI needs at least 1 FWD");
  if (posOf.get(bench[0]) !== "GK") throw new RuleError("benchgk", "bench slot 1 must be the reserve GK");
  if (!xi.includes(captain) || !xi.includes(vice)) throw new RuleError("armband", "captain and vice must start");
  if (captain === vice) throw new RuleError("armband", "captain and vice must differ");
  return { xi, bench, captain, vice };
}

// ── Credits (founder-locked 11 Jul — kinder floor after playtest) ─────────────
// 3 correct earns your first transfer, then +1 every 2 correct up to 4 at 9/11.
// (FPL gives 1 free transfer/week; a great round here still out-earns that.)
export function creditsForRound(correct: number): number {
  return correct >= 9 ? 4 : correct >= 7 ? 3 : correct >= 5 ? 2 : correct >= 3 ? 1 : 0;
}
export function bankCredits(current: number, minted: number): number {
  return Math.min(CREDIT_CAP, current + minted);
}

/** Credits the bank can't hold cash out as points — OVERFLOW ONLY (founder, 14 Jul).
 *
 *  The hole this fills: the round's only payoff was transfers, so a manager happy
 *  with his team earned NOTHING from a perfect 11/11 — at the cap, literally zero.
 *  The game's own differentiator was optional and unrewarding.
 *
 *  Overflow-only is what keeps the transfer the better deal: you never drain a bank
 *  you might want, you just stop wasting what won't fit. Cashing is the consolation
 *  prize, not the optimal play.
 *
 *  A CAP on the cash was tried and rejected — it restores cheat-resistance, but it
 *  makes 3 correct pay the same as 11, and then there's no reason to answer the
 *  other eight questions. The round has to reward knowing more. */
export function cashOverflow(current: number, minted: number): { credits: number; points: number } {
  const credits = bankCredits(current, minted);
  const spilled = Math.max(0, current + minted - CREDIT_CAP);
  return { credits, points: spilled * CASH_POINTS };
}

/** What you get for selling — FPL's own rule (founder-locked 14 Jul):
 *  a rise pays you back HALF of it, rounded down to 0.1; a fall costs you the lot.
 *
 *  This is the parity mechanism, not a detail. Weekly prices with a sell-at-what-you-
 *  paid rule is a slow squeeze — your fixed £100m buys less every week and you could
 *  only ever downgrade. Half-the-rise lets team value climb with the market, exactly
 *  as FPL managers already expect. */
export function sellPrice(buyTenths: number, currentTenths: number): number {
  if (currentTenths <= buyTenths) return currentTenths;
  return buyTenths + Math.floor((currentTenths - buyTenths) / 2);
}
/** How the next transfer is paid: knowledge first, points after.
 *  On a wildcard week every move is free — that's the whole chip. */
export function transferCost(creditsLeft: number, wildcard = false): { paid: "credit" | "hit" | "free" } {
  if (wildcard) return { paid: "free" };
  return { paid: creditsLeft > 0 ? "credit" : "hit" };
}

// ── Chips (D:123-156) ────────────────────────────────────────────────────────
/** The chip token, spent as whichever chip you want. `wildcard` runs on its own
 *  track (issued, not earned) but is played through the same slot: one per week. */
export type Chip = "triple_captain" | "bench_boost" | "insight" | "second_chance" | "wildcard";
// "second_chance" stays in the TYPE (historic entry rows may carry it) but is no
// longer PLAYABLE — the founder cut it on 22 Jul ("remove the Second Chance").
export const CHIPS: readonly Chip[] = ["triple_captain", "bench_boost", "insight", "wildcard"];

/** Loyalty, not performance: a token every GAMEWEEKS_PER_CHIP gameweeks you
 *  actually PLAY. Miss a week and you accrue slower — no wipe, no grace needed
 *  (D:123-127). A week your squad merely rolled over does NOT count: skipping the
 *  round earns "no transfer credits or chip progress that week" (D:91-93). */
export const GAMEWEEKS_PER_CHIP = 4;
export const CHIP_HOLD_CAP = 3;

/** Advance chip accrual by one PLAYED gameweek. Returns the new progress and
 *  whether a token was minted. At the hold cap, progress simply stops — you can't
 *  bank a fifth week of credit toward a chip you're not allowed to hold. */
export function accrueChip(
  progress: number, held: number,
): { progress: number; held: number; minted: boolean } {
  if (held >= CHIP_HOLD_CAP) return { progress, held, minted: false };
  const next = progress + 1;
  if (next < GAMEWEEKS_PER_CHIP) return { progress: next, held, minted: false };
  return { progress: 0, held: held + 1, minted: true };
}

/** Season halves — the wildcard is use-it-or-lose-it at the halfway deadline
 *  (D:147-149), FPL's Christmas spike. GW1-19 then GW20-38. */
export const HALF_SEASON_GW = 19;
export const halfOf = (gw: number): 1 | 2 => (gw <= HALF_SEASON_GW ? 1 : 2);

/** A PERFECT round mints one bonus wildcard — the marquee earned moment — but at
 *  most ONE bonus per half, so elite quizzers can't stockpile them weekly. Further
 *  perfect rounds overflow into banked transfer credits instead (D:150-154). */
export function perfectRoundReward(
  correct: number, total: number, bonusUsedThisHalf: boolean,
): { wildcard: boolean; credits: number } {
  if (correct < total) return { wildcard: false, credits: 0 };
  return bonusUsedThisHalf ? { wildcard: false, credits: 1 } : { wildcard: true, credits: 0 };
}

// ── Transfers ────────────────────────────────────────────────────────────────
/** Swap `outId` → `inId` (same position, club cap holds, bank stays ≥ 0). */
export function applyTransfer(squad: Squad, outId: number, inId: number, pool: PoolPlayer[]): Squad {
  const index = byId(pool);
  const out = squad.picks.find((p) => p.id === outId);
  if (!out) throw new RuleError("unknown", "player being sold is not in your squad");
  if (squad.picks.some((p) => p.id === inId)) throw new RuleError("dup", "player already in your squad");
  const inn = index.get(inId);
  if (!inn) throw new RuleError("unknown", `unknown player id ${inId}`);
  if (inn.pos !== out.pos) throw new RuleError("pos", "replacement must play the same position");
  const clubCount = new Map<number, number>();
  for (const p of squad.picks) if (p.id !== outId) clubCount.set(p.clubId, (clubCount.get(p.clubId) ?? 0) + 1);
  if ((clubCount.get(inn.clubId) ?? 0) + 1 > MAX_PER_CLUB)
    throw new RuleError("club", `more than ${MAX_PER_CLUB} players from one club`);
  // Sell at FPL's rule against the CURRENT price, not at what you paid. Prices move
  // weekly, so refunding buyTenths at par would squeeze you into downgrading forever.
  // A player missing from the pool (left the league mid-season) can only be sold for
  // what you paid — there is no current price to halve.
  const outNow = index.get(outId);
  const sold = outNow ? sellPrice(out.buyTenths, outNow.priceTenths) : out.buyTenths;
  const bank = squad.bankTenths + sold - inn.priceTenths;
  if (bank < 0) throw new RuleError("budget", "not enough budget for that swap");
  return {
    picks: squad.picks.map((p) => p.id === outId
      ? { id: inn.id, pos: inn.pos, clubId: inn.clubId, buyTenths: inn.priceTenths } : p),
    bankTenths: bank,
  };
}

// ── Smart defaults (the low floor: zero homework after the round) ────────────
/** Best-XI by price (pre-season form proxy), captain = priciest, bench auto-order. */
export function smartDefaults(squad: Squad, pool: PoolPlayer[]): Selection {
  const index = byId(pool);
  const priceOf = (id: number) => index.get(id)?.priceTenths ?? 0;
  const sorted = [...squad.picks].sort((a, b) => priceOf(b.id) - priceOf(a.id));
  const gks = sorted.filter((p) => p.pos === "GK");
  const defs = sorted.filter((p) => p.pos === "DEF");
  const fwds = sorted.filter((p) => p.pos === "FWD");
  const xi = [gks[0], ...defs.slice(0, 3), fwds[0]];
  const rest = sorted.filter((p) => p.pos !== "GK" && !xi.includes(p));
  xi.push(...rest.slice(0, XI_SIZE - xi.length));
  const xiIds = xi.map((p) => p.id);
  const benchOutfield = sorted.filter((p) => p.pos !== "GK" && !xiIds.includes(p.id)).map((p) => p.id);
  const bench = [gks[1].id, ...benchOutfield];
  const outfieldXi = xi.filter((p) => p.pos !== "GK").sort((a, b) => priceOf(b.id) - priceOf(a.id));
  return { xi: xiIds, bench, captain: outfieldXi[0]?.id ?? xiIds[0], vice: outfieldXi[1]?.id ?? xiIds[1] };
}

// ── Auto-subs (bench order, GK↔GK, formation floors hold) ────────────────────
export interface AutoSubResult { xi: number[]; subs: { out: number; in: number }[] }
export function autoSubs(sel: LockedSelection, minutes: Map<number, number>): AutoSubResult {
  const posOf = new Map(sel.picks.map((p) => [p.id, p.pos]));
  const played = (id: number) => (minutes.get(id) ?? 0) > 0;
  let xi = [...sel.xi];
  const subs: { out: number; in: number }[] = [];
  const used = new Set<number>();
  const legalAfter = (candidateXi: number[]) => {
    const count = (pos: FantasyPos) => candidateXi.filter((id) => posOf.get(id) === pos).length;
    return count("GK") === 1 && count("DEF") >= 3 && count("FWD") >= 1;
  };
  for (const starter of sel.xi) {
    if (played(starter)) continue;
    const isGk = posOf.get(starter) === "GK";
    for (const b of sel.bench) {
      if (used.has(b) || !played(b)) continue;
      if ((posOf.get(b) === "GK") !== isGk) continue;
      const candidate = xi.map((id) => (id === starter ? b : id));
      if (!legalAfter(candidate)) continue;
      xi = candidate; used.add(b); subs.push({ out: starter, in: b });
      break;
    }
  }
  return { xi, subs };
}

/** Armband chain: captain → vice steps up → best-form playing starter. */
export function effectiveCaptain(
  sel: LockedSelection,
  finalXi: number[],
  minutes: Map<number, number>,
  form: Map<number, number>,
): number {
  if ((minutes.get(sel.captain) ?? 0) > 0) return sel.captain;
  if ((minutes.get(sel.vice) ?? 0) > 0) return sel.vice;
  const playing = finalXi.filter((id) => (minutes.get(id) ?? 0) > 0);
  if (!playing.length) return sel.captain; // nobody played — double a zero, harmless
  return playing.reduce((best, id) => ((form.get(id) ?? 0) > (form.get(best) ?? 0) ? id : best), playing[0]);
}

// ── Entry scoring (pure recompute — the idempotency contract) ────────────────
export interface PlayerScore { points: number; facts: MatchFacts }
export interface EntryResult {
  total: number;
  captainUsed: number;
  subs: { out: number; in: number }[];
  breakdown: { id: number; points: number; captain: boolean; subbedIn: boolean; facts: MatchFacts }[];
  hitsDeducted: number;
  /** Points from credits the bank couldn't hold — a line item on the result card,
   *  so the round's contribution to the score is visible rather than baked in. */
  cashPoints: number;
}
export function scoreEntry(
  sel: LockedSelection,
  hits: number,
  scores: Map<number, PlayerScore>,
  form: Map<number, number> = new Map(),
  chip: Chip | null = null,
  cashPoints = 0,
): EntryResult {
  const minutes = new Map<number, number>();
  for (const p of sel.picks) minutes.set(p.id, scores.get(p.id)?.facts.minutes ?? 0);

  // Bench Boost: all 15 score, so there is nothing to substitute FOR — a starter
  // who didn't play is already worth exactly what his replacement is worth. Auto-subs
  // are therefore off, as in FPL.
  const benchBoost = chip === "bench_boost";
  const { xi, subs } = benchBoost
    ? ({ xi: sel.xi, subs: [] } as AutoSubResult)
    : autoSubs(sel, minutes);
  const scoring = benchBoost ? [...sel.xi, ...sel.bench] : xi;

  const cap = effectiveCaptain(sel, xi, minutes, form);
  const capMultiplier = chip === "triple_captain" ? 3 : 2;
  const subbedIn = new Set(subs.map((s) => s.in));

  let total = 0;
  const breakdown = scoring.map((id) => {
    let pts = scores.get(id)?.points ?? 0;
    const isCap = id === cap;
    if (isCap) pts *= capMultiplier;
    total += pts;
    return { id, points: pts, captain: isCap, subbedIn: subbedIn.has(id), facts: scores.get(id)?.facts ?? ZERO_FACTS };
  });

  // A wildcard week's transfers were free, so there is nothing to deduct — the
  // caller records 0 hits for that week, and this stays a pure sum either way.
  const hitsDeducted = hits * HIT_POINTS;
  total -= hitsDeducted;
  // Credits the bank couldn't hold, cashed at the same rate a transfer costs.
  // Passed in from the stored entry rather than recomputed, so a re-score can
  // never drop them.
  total += cashPoints;
  return { total, captainUsed: cap, subs, breakdown, hitsDeducted, cashPoints };
}

export { pointsFor, type MatchFacts, type FantasyPos };
