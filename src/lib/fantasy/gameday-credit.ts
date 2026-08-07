import "server-only";
/**
 * The gameday → fantasy credit sweep (founder-locked, rewritten 28 Jul —
 * replaces the old halftime-link, which minted a credit per qualifying attempt).
 *
 * Your FIRST gameday quiz this gameweek earns transfers for NEXT gameweek, on the
 * EXACT same scale as the neutral round — both call engine `creditsForRound`, so
 * the cap-of-2 curve (5 correct → 1, 10 → 2, founder 7 Aug) applies identically
 * whichever quiz a manager plays. It feeds the same "earned for next week" tray
 * the round does: we RAISE the tray to the better of what's there and what this
 * quiz scored (raisePending). The rules, all founder-locked:
 *   - only the FIRST gameday quiz played counts — a later, higher-scoring one is
 *     ignored (pending_gameday_done locks the slot for the cycle);
 *   - club is irrelevant — own club or not, first played is the one that counts;
 *   - the neutral round can still override the tray UPWARD, never down;
 *   - squad holders only — a gameday-only player is untouched.
 *
 * The timing is clean: gameday quizzes are played while the current gameweek is
 * LOCKED (matches on), so nothing here can touch the week in play — it only ever
 * builds next week's credits. Settlement (finaliseGameweek) pours the tray into
 * the spendable bank when the next gameweek opens, then resets it.
 *
 * Zero coupling to the gameday branch's code: packs land in shared quiz_packs
 * with the fixture linkage in metadata.gameday; attempts land in shared
 * quiz_attempts. This sweep reads those two tables and the squad, nothing else.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { creditsForRound, raisePending } from "./engine";
import type { SeasonGw } from "./season";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", any>;

export async function gamedayEarn(db: Db, gw: SeasonGw): Promise<{ updated: number }> {
  // Attempts inside the gameweek's match window (+2 days for late kickoffs),
  // earliest first so "the first gameday quiz played" is well-defined.
  const windowEnd = new Date(new Date(`${gw.window_end}T00:00:00Z`).getTime() + 48 * 3600_000).toISOString();
  const { data: attempts } = await db.from("quiz_attempts")
    .select("id, user_id, pack_id, correct_count, completed_at")
    .gte("completed_at", `${gw.window_start}T00:00:00Z`).lte("completed_at", windowEnd)
    .order("completed_at", { ascending: true }).range(0, 9999);
  const rows = (attempts ?? []) as { id: string; user_id: string; pack_id: string; correct_count: number }[];
  if (!rows.length) return { updated: 0 };

  // Gameday packs only — the linkage lives in quiz_packs.metadata.gameday. (The
  // old sweep read metadata.halftime, which the Jul-23 pivot stopped writing —
  // that mismatch is exactly why the bridge minted nothing. This reads what the
  // live gameday publisher actually writes.)
  const packIds = Array.from(new Set(rows.map((r) => r.pack_id)));
  const { data: packs } = await db.from("quiz_packs")
    .select("id, metadata").in("id", packIds).range(0, 9999);
  const gamedayPacks = new Set(((packs ?? []) as { id: string; metadata: { gameday?: unknown } | null }[])
    .filter((p) => p.metadata && typeof p.metadata === "object" && "gameday" in p.metadata)
    .map((p) => p.id));
  const qualifying = rows.filter((r) => gamedayPacks.has(r.pack_id));
  if (!qualifying.length) return { updated: 0 };

  // The FIRST gameday attempt per user (rows are ordered by completed_at asc, so
  // the first one we see for a user is the earliest they played).
  const firstOf = new Map<string, { correct_count: number }>();
  for (const a of qualifying) if (!firstOf.has(a.user_id)) firstOf.set(a.user_id, { correct_count: a.correct_count });

  const userIds = Array.from(firstOf.keys());
  const { data: squads } = await db.from("fantasy_squads")
    .select("user_id, pending_credits, pending_gameday_done, version").in("user_id", userIds);
  const squadOf = new Map(((squads ?? []) as {
    user_id: string; pending_credits: number; pending_gameday_done: boolean; version: number;
  }[]).map((s) => [s.user_id, s]));

  let updated = 0;
  for (const [userId, first] of Array.from(firstOf)) {
    const squad = squadOf.get(userId);
    if (!squad) continue;                     // plays gameday quizzes, not fantasy — untouched
    if (squad.pending_gameday_done) continue; // this cycle's gameday slot is already spent

    const earned = creditsForRound(first.correct_count);
    const patch: Record<string, unknown> = {
      pending_credits: raisePending(squad.pending_credits, earned),
      pending_gameday_done: true, // lock the slot: only the FIRST gameday quiz counts
      version: squad.version + 1,
    };
    if (earned > squad.pending_credits) patch.pending_source = "gameday";

    // CAS on version: if a concurrent transfer or the round bumped the squad, skip
    // — the done flag is still false, so the next sweep re-reads and nothing is
    // lost (the same attempt is still the earliest, still uncounted).
    const { data: done } = await db.from("fantasy_squads")
      .update(patch).eq("user_id", userId).eq("version", squad.version).select("version");
    if (done?.length) updated++;
  }
  return { updated };
}
