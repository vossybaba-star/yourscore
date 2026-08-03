import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", any>;

/**
 * Auto-memberships every manager gets, kept current on each Leagues load
 * (founder, 3 Aug):
 *   - Their club's fan league (from club_supporters — the club they support).
 *   - The Founder League + a Legend badge, if they're one of the first 1,000
 *     managers to build a squad.
 * Idempotent, and never allowed to block the page — a failure just means the
 * membership shows up on the next load.
 */
const FOUNDER_CAP = 1000;
// QA / health-bot accounts never become Legends or Founder-League members (they
// already stay out of the public feed the same way).
const QA_ACCOUNTS = new Set([
  "cf78de0e-da93-4fb8-b3cd-8865ae0a0814",
  "aa6542bc-ea1d-480c-9070-4a6b79c87381",
]);

export async function ensureAutoLeagues(db: Db, userId: string): Promise<void> {
  if (QA_ACCOUNTS.has(userId)) return;
  try {
    // 1. Club fan league for the club they support (newest season on file).
    const { data: sup } = await db.from("club_supporters")
      .select("club").eq("user_id", userId).order("season_id", { ascending: false }).limit(1).maybeSingle();
    if (sup?.club) {
      const { data: cl } = await db.from("fantasy_leagues").select("id").eq("kind", "club").eq("club", sup.club).maybeSingle();
      if (cl) await db.from("fantasy_league_members").upsert({ league_id: cl.id, user_id: userId }, { onConflict: "league_id,user_id" });
    }

    // 2. Founder League + Legend badge for the first 1,000 to build a squad.
    const { data: squad } = await db.from("fantasy_squads").select("user_id").eq("user_id", userId).maybeSingle();
    if (!squad) return;

    const { data: legend } = await db.from("fantasy_legends").select("user_id").eq("user_id", userId).maybeSingle();
    let isLegend = !!legend;
    if (!isLegend) {
      const { count } = await db.from("fantasy_legends").select("*", { count: "exact", head: true });
      if ((count ?? 0) < FOUNDER_CAP) {
        const { error } = await db.from("fantasy_legends").insert({ user_id: userId, rank: (count ?? 0) + 1 });
        if (!error) isLegend = true;
      }
    }
    if (isLegend) {
      const { data: fl } = await db.from("fantasy_leagues").select("id").eq("kind", "founder").maybeSingle();
      if (fl) await db.from("fantasy_league_members").upsert({ league_id: fl.id, user_id: userId }, { onConflict: "league_id,user_id" });
    }
  } catch { /* never block the page on auto-join */ }
}
