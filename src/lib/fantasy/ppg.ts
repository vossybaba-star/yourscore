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
 *  TWO EXPORTS LIVE HERE, and that is the whole point of the file.
 *  `pointsPerAppearance` divides by APPEARANCES; `seasonAverageScores` divides
 *  by GAMEWEEKS ELAPSED. Both definitions are deliberate and both are correct —
 *  for their own job:
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

/** Season-to-date average points per GAMEWEEK ELAPSED, per player — the ranking
 *  basis the transfer planner uses.
 *
 *  Divides by `gwsElapsed`, NOT by appearances, and that difference is the
 *  entire reason this function is not `pointsPerAppearance`. The planner is
 *  valuing a SQUAD SLOT: a player who was injured, benched or rotated returned
 *  nothing to the manager those weeks, and a slot that returns nothing is
 *  exactly what the planner exists to surface. Excluding his blank weeks would
 *  flatter him precisely when the tool should be flagging him.
 *
 *  Returns NULL when no gameweek has been scored yet (`gwsElapsed <= 0`). That
 *  null is load-bearing, not defensive: it is what drives the planner's
 *  `basis: "no-history-yet"` cold-start path, where every player projects flat,
 *  the search finds nothing, and the screen says so. A zero-filled map would be
 *  indistinguishable from "everyone is genuinely averaging zero" and would let
 *  the planner present a confident ordering built on no evidence at all.
 *
 *  A player with no rows averages 0, which is correct: he has not scored. Pure —
 *  callers query `fantasy_player_scores` (NEVER `fantasy_fpl_snapshot`, whose
 *  `total_points`/`minutes` hold last season) and pass the rows in.
 *
 *  `playerIds` fixes the key set so every pool player is present in the result
 *  even with no rows — the planner builds a projection map over the whole pool
 *  and a missing key would read as a hole rather than as a zero. */
export function seasonAverageScores(
  rows: ScoreRow[], gwsElapsed: number, playerIds: number[],
): Map<number, number> | null {
  if (gwsElapsed <= 0) return null;
  const sum = new Map<number, number>();
  for (const r of rows) sum.set(r.player_id, (sum.get(r.player_id) ?? 0) + (r.points ?? 0));
  return new Map(playerIds.map((id) => [id, (sum.get(id) ?? 0) / gwsElapsed]));
}
