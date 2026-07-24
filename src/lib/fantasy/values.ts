/**
 * YourScore Fantasy Football — THE scoring values. One source, zero imports.
 *
 * These ARE Fantasy Premier League's scoring values (founder-locked, 23 Jul
 * 2026). Not "inspired by", not "calibrated against" — identical, with exactly
 * one deliberate omission: FPL's BPS bonus, which is a judged ranking rather
 * than a public match fact, and would break our promise that a player can audit
 * every point they scored.
 *
 * Why copy rather than invent (the reasoning, so nobody re-opens it):
 *  - FPL has balanced goals against appearances against the -4 hit over twenty
 *    years of live play. Inventing our own numbers put every one of those
 *    ratios back in play, and we got several of them wrong — see
 *    [[feedback-scale-mismatch-bug-class]]. Using their table makes a whole
 *    class of scale bugs impossible by construction.
 *  - It costs us nothing distinctive. Our old values ranked players at Spearman
 *    0.99 against FPL, so this changes the numbers on the screen, not who is
 *    good. YourScore's differentiation lives in the ECONOMY — quiz-earned
 *    transfers, cash-out, the weekly free — not in what a goal is worth.
 *  - A user can now compare their week to their FPL week and see the same
 *    shape, which makes us legible to the millions who already play that game.
 *
 * VERIFIED, not asserted: this table reproduces `total_points - bonus` EXACTLY
 * on 4,836 real per-fixture rows across six 2025/26 gameweeks (GW5, 12, 19, 25,
 * 30, 36). Every rule below is exercised by that data, including 30 goalkeeper
 * appearances above the defensive-contribution threshold, which is what proves
 * keepers are NOT eligible for it. Re-run with
 * `bash scripts/fantasy/familiarity.sh` — the bar is 100% exact, not a
 * correlation. Any change to these numbers must re-pass it.
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

/** Bumped from "v1" when the scoring table moved to FPL's own values. Rows
 *  written under "v1" used the old ~2.6x scale and are NOT comparable. */
export const SCORING_VERSION = "v2-fpl";

export const ZERO_FACTS: MatchFacts = {
  minutes: 0, goals: 0, assists: 0, cleanSheet: 0, conceded: 0, saves: 0,
  pensSaved: 0, pensMissed: 0, yellows: 0, reds: 0, ownGoals: 0, dc: 0, dcRec: 0,
};

/** YourScore points for one player's gameweek. Pure; total is the only output. */
export function pointsFor(pos: FantasyPos, f: MatchFacts): number {
  let p = 0;
  p += f.minutes >= 60 ? 2 : f.minutes > 0 ? 1 : 0;
  p += f.goals * (pos === "GK" || pos === "DEF" ? 6 : pos === "MID" ? 5 : 4);
  p += f.assists * 3;
  if (f.minutes >= 60 && f.cleanSheet) p += pos === "GK" || pos === "DEF" ? 4 : pos === "MID" ? 1 : 0;
  if (pos === "GK") p += Math.floor(f.saves / 3) + f.pensSaved * 5;
  if (pos === "GK" || pos === "DEF") p -= Math.floor(f.conceded / 2);
  p -= f.pensMissed * 2 + f.yellows + f.reds * 3 + f.ownGoals * 2;
  // Defensive contribution. Defenders clear 10 CBIT; midfielders and forwards
  // need 12 but may count ball recoveries too. Goalkeepers are NOT eligible —
  // 30 keeper appearances in the sample clear 12 CBIRT and FPL paid them zero.
  if (pos === "DEF" ? f.dc >= 10 : pos !== "GK" && f.dcRec >= 12) p += 2;
  return p;
}
