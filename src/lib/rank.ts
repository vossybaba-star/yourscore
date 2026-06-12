/**
 * YourScore Rank v2 — shared client/server helpers.
 *
 * One currency: YourScore points = Knowledge (quiz) + Match (38-0: win 1500,
 * draw 500 — the exchange rate lives in supabase/migrations/30_yourscore_points.sql).
 * The leaderboard POSITION is the product; badges are cosmetic flavour derived
 * from position only, so they never need to agree with any SQL.
 */

export type RankRow = {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  knowledge_score: number;
  match_score: number;
  overall_score: number;
  overall_rank: number;
  wins: number;
  draws: number;
  losses: number;
  ahead_name?: string | null;
  ahead_points?: number | null;
};

/** Display value of a 38-0 result in YourScore points (mirror of the SQL rate). */
export const WIN_POINTS = 1500;
export const DRAW_POINTS = 500;

export type Badge = { label: string; emoji: string; color: string } | null;

/** Cosmetic badge from leaderboard position. Position is the real status. */
export function positionBadge(position: number | null | undefined): Badge {
  if (!position || position < 1) return null;
  if (position === 1) return { label: "Top of the table", emoji: "👑", color: "#ffd700" };
  if (position <= 10) return { label: "Elite", emoji: "🏅", color: "#00ff87" };
  if (position <= 50) return { label: "Diamond", emoji: "💎", color: "#a78bfa" };
  if (position <= 200) return { label: "Platinum", emoji: "🔷", color: "#67e8f9" };
  if (position <= 1000) return { label: "Gold", emoji: "🥇", color: "#ffb800" };
  return null;
}

/** Accent colour for a position (badge colour, or neutral when unbadged). */
export function positionColor(position: number | null | undefined): string {
  return positionBadge(position)?.color ?? "#8888aa";
}
