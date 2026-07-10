/**
 * YourScore Fantasy Football — THE scoring values. One source, zero imports.
 *
 * Deterministic, no BPS-style judged bonus (design §3, founder-locked): every
 * point traces to a public match fact. Validated at the familiarity ceiling on
 * real gameweeks (Spearman 0.99 vs FPL actual, GW30+GW15 25/26) — any change to
 * these numbers must re-pass `bash scripts/fantasy/familiarity.sh` (≥ 0.98).
 * Scale ≈ 2.6× FPL so the numbers read as ours.
 */

export type FantasyPos = "GK" | "DEF" | "MID" | "FWD";

/** Raw per-player match facts for one gameweek (already aggregated across
 *  that player's fixtures in the GW — doubles simply sum). */
export interface MatchFacts {
  minutes: number;
  goals: number;
  assists: number;
  /** 1 if 60+ minutes and no goal conceded while on the pitch (team CS). */
  cleanSheet: number;
  /** Goals conceded while the player was on the pitch. */
  conceded: number;
  saves: number;
  pensSaved: number;
  pensMissed: number;
  yellows: number;
  reds: number;
  ownGoals: number;
  /** Defensive contribution: clearances + interceptions + tackles + blocked shots. */
  dc: number;
  /** dc + ball recoveries (the non-defender threshold pool). */
  dcRec: number;
}

export const SCORING_VERSION = "v1";

export const ZERO_FACTS: MatchFacts = {
  minutes: 0, goals: 0, assists: 0, cleanSheet: 0, conceded: 0, saves: 0,
  pensSaved: 0, pensMissed: 0, yellows: 0, reds: 0, ownGoals: 0, dc: 0, dcRec: 0,
};

/** YourScore points for one player's gameweek. Pure; total is the only output. */
export function pointsFor(pos: FantasyPos, f: MatchFacts): number {
  let p = 0;
  p += f.minutes >= 60 ? 6 : f.minutes > 0 ? 3 : 0;
  p += f.goals * (pos === "GK" || pos === "DEF" ? 15 : pos === "MID" ? 13 : 11);
  p += f.assists * 8;
  if (f.minutes >= 60 && f.cleanSheet) p += pos === "GK" || pos === "DEF" ? 10 : pos === "MID" ? 3 : 0;
  if (pos === "GK") p += Math.floor(f.saves / 3) * 2 + f.pensSaved * 12;
  if (pos === "GK" || pos === "DEF") p -= Math.floor(f.conceded / 2) * 2;
  p -= f.pensMissed * 5 + f.yellows * 3 + f.reds * 8 + f.ownGoals * 5;
  // Defensive contribution — our own award (deterministic threshold, no judging)
  if (pos === "DEF" ? f.dc >= 10 : f.dcRec >= 12) p += 5;
  return p;
}
