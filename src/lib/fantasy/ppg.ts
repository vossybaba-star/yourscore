/** The ONE module in this repo permitted to compute points per game.
 *
 *  It reads ONLY fantasy_player_scores for historical points. It must NEVER
 *  read fantasy_fpl_snapshot.total_points or fantasy_fpl_snapshot.minutes —
 *  those fields hold LAST SEASON's figures. Verified today (24 Jul): a player
 *  reads 209 points in fantasy_fpl_snapshot.total_points while zero 26/27
 *  matches have been played. Any computation that touches those two fields
 *  for a current-season average is silently averaging in last year.
 *
 *  The GW1-5 cold start does not use this file at all — it uses
 *  fantasy_fpl_snapshot.ep_next only, which is a forward projection, not a
 *  historical total, and is already correctly labelled Beta in the UI.
 *
 *  This file will gain a second export in Phase 2: `seasonAverageScores`,
 *  which divides a player's total points by GAMEWEEKS ELAPSED rather than by
 *  APPEARANCES. Both definitions are deliberate and both are correct — for
 *  their own job:
 *    - pointsPerAppearance answers "when he actually plays, what does he do?"
 *      (captaincy: you only care about output in games he starts)
 *    - seasonAverageScores answers "what has this squad slot returned?"
 *      (the transfer planner: a squad slot that returns nothing on a blank
 *      or bench week is exactly what should be flagged, not excluded)
 *  They live in ONE file, side by side, specifically so they are never
 *  confused for each other. This codebase has shipped six separate bugs from
 *  this exact failure shape: two groups measured on different scales/sources,
 *  then compared or combined as if they were the same thing. Do not add a
 *  third definition anywhere else, and do not let either of these two drift
 *  into computing the other's job.
 */

/** A single row from fantasy_player_scores, narrowed to what PPG needs. */
export type ScoreRow = { gw: number; player_id: number; points: number | null; minutes: number | null };

/** Points per appearance this season, per player.
 *
 *  An "appearance" is any row with minutes > 0. Players with zero
 *  appearances score 0 rather than dividing by zero. Purely a function of
 *  the rows it is given — callers are responsible for querying only
 *  fantasy_player_scores (never fantasy_fpl_snapshot) to build them.
 */
export function pointsPerAppearance(rows: ScoreRow[]): Map<number, number> {
  const agg = new Map<number, { pts: number; apps: number }>();
  for (const s of rows) {
    const cur = agg.get(s.player_id) ?? { pts: 0, apps: 0 };
    cur.pts += s.points ?? 0;
    if ((s.minutes ?? 0) > 0) cur.apps += 1;
    agg.set(s.player_id, cur);
  }
  const result = new Map<number, number>();
  // forEach rather than for..of: this tsconfig target cannot iterate a Map directly.
  agg.forEach((a, id) => result.set(id, a.apps ? a.pts / a.apps : 0));
  return result;
}
