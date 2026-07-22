/**
 * Halftime prediction poll — the pure core.
 *
 * A fan finishes a halftime pack and makes ONE call on the second half: home
 * win, draw, or away win. At full time we grade it. This module is DB-free and
 * SportMonks-free on purpose — it is the part that is worth unit-testing: the
 * result classification, the parsing of a SportMonks score payload into a final
 * result, the grading, and the copy. The routes own every read/write; this only
 * transforms already-fetched values, so shared.test.ts-style tests need no
 * bundler and no network.
 */

export type Pick = "home" | "draw" | "away";

export const PICKS: readonly Pick[] = ["home", "draw", "away"] as const;

export function isPick(v: unknown): v is Pick {
  return v === "home" || v === "draw" || v === "away";
}

/** Which side a final scoreline favours. Level → draw. */
export function resultFromGoals(homeGoals: number, awayGoals: number): Pick {
  if (homeGoals > awayGoals) return "home";
  if (awayGoals > homeGoals) return "away";
  return "draw";
}

// ── SportMonks score parsing ──────────────────────────────────────────────────
//
// A v3 fixture carries a `scores` array. Each entry is one side's tally at one
// stage of the match; the RUNNING TOTAL (which at full time IS the final result)
// is the pair of entries whose description is "CURRENT" — one per participant,
// keyed by `score.participant` ("home" | "away"). We read only those; the
// per-period entries ("1ST_HALF", "2ND_HALF") are ignored — summing them would
// double-count and break on extra time.

export interface SmScoreEntry {
  description?: string;
  score?: { goals?: number; participant?: string } | null;
}

/**
 * Final home/away goals from a fixture's `scores` array, or null if the current
 * total is not present for both sides (match not far enough along / feed gap).
 * Caller decides a fixture is settle-able from its match phase; this only reads
 * the number off a payload that phase said was finished.
 */
export function finalGoalsFromScores(
  scores: SmScoreEntry[] | null | undefined,
): { home: number; away: number } | null {
  if (!Array.isArray(scores)) return null;
  let home: number | null = null;
  let away: number | null = null;
  for (const s of scores) {
    if (s?.description !== "CURRENT") continue;
    const goals = s.score?.goals;
    const side = s.score?.participant;
    if (typeof goals !== "number") continue;
    if (side === "home") home = goals;
    else if (side === "away") away = goals;
  }
  if (home === null || away === null) return null;
  return { home, away };
}

// ── Tally (server-side social proof) ──────────────────────────────────────────

export interface Tally {
  home: number;
  draw: number;
  away: number;
  total: number;
}

/** Count picks into a {home,draw,away,total} tally. */
export function tallyPicks(picks: Array<{ pick: Pick }>): Tally {
  const t: Tally = { home: 0, draw: 0, away: 0, total: 0 };
  for (const p of picks) {
    if (p.pick === "home") t.home++;
    else if (p.pick === "draw") t.draw++;
    else if (p.pick === "away") t.away++;
    else continue;
    t.total++;
  }
  return t;
}

/** Whole-percent share of one pick in a tally (0 when nobody has voted). */
export function tallyPercent(tally: Tally, pick: Pick): number {
  if (tally.total <= 0) return 0;
  return Math.round((tally[pick] / tally.total) * 100);
}

// ── Grading ───────────────────────────────────────────────────────────────────

/**
 * Grade a set of picks against the settled result. Returns, per user, whether
 * they called it. Pure: the settle path hands us the fixture's rows and result
 * and persists what comes back.
 */
export function gradePicks(
  picks: Array<{ userId: string; pick: Pick }>,
  result: Pick,
): Array<{ userId: string; correct: boolean }> {
  return picks.map((p) => ({ userId: p.userId, correct: p.pick === result }));
}

// ── Copy (no score, no first-half spoiler, locked vocabulary) ─────────────────
//
// The poll is shown during the second half, so its copy must never leak the live
// score — same spoiler rule as the pack and the push. It sells the call, not the
// scoreline.

/** The label on each option button, given the two team names. */
export function optionLabel(pick: Pick, home: string, away: string): string {
  if (pick === "home") return `${home} win`;
  if (pick === "away") return `${away} win`;
  return "Draw";
}

/** The prompt shown above the three options. */
export function pollPrompt(home: string, away: string): string {
  return `How does ${home} v ${away} end?`;
}

/** After a fan has picked, before the result is known. */
export function pendingLine(pick: Pick, home: string, away: string): string {
  return `You called it: ${optionLabel(pick, home, away)}. Back at full time.`;
}

/** Once settled — did they get it right. `resultPick` is the actual outcome. */
export function settledLine(
  myPick: Pick | null,
  resultPick: Pick,
  home: string,
  away: string,
): string {
  const outcome = optionLabel(resultPick, home, away);
  if (myPick === null) return `Full time: ${outcome}.`;
  if (myPick === resultPick) return `Full time: ${outcome}. You called it. ✅`;
  return `Full time: ${outcome}. Not this time. ❌`;
}
