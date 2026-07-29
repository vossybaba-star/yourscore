/** Captain Assist adoption funnel.
 *
 *  Separate from the shadow OUTCOME on purpose: this measures whether users saw,
 *  trusted and kept the recommendation, which is a different question from
 *  whether the recommendation was any good. Conflating them would let a
 *  well-adopted weak model look like a win.
 *
 *  One row per user per gameweek, upserted. Steps are monotonic flags rather
 *  than an event log because the question is "did this user reach this step in
 *  this gameweek", not "how many times did they click".
 *
 *  The decisive field, recommendation_followed_at_deadline, is NOT set here. A
 *  user can confirm a change and then reverse it before the deadline, so only
 *  the immutable deadline squad can decide whether they actually followed it.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", any>;

export const FUNNEL_EVENTS = [
  "viewed", "expanded", "prepare_clicked", "confirmation_opened",
  "captain_applied", "vice_applied", "dismissed", "refresh_required",
  "blocked_after_deadline",
] as const;
export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

const COLUMN: Record<FunnelEvent, string> = {
  viewed: "recommendation_viewed",
  expanded: "recommendation_expanded",
  prepare_clicked: "prepare_clicked",
  confirmation_opened: "confirmation_opened",
  captain_applied: "captain_applied",
  vice_applied: "vice_applied",
  dismissed: "dismissed",
  refresh_required: "refresh_required",
  blocked_after_deadline: "blocked_after_deadline",
};

export function isFunnelEvent(x: unknown): x is FunnelEvent {
  return typeof x === "string" && (FUNNEL_EVENTS as readonly string[]).includes(x);
}

/** Record a funnel step. Never throws into the caller: losing an analytics flag
 *  must not break a user's captain change. */
export async function recordFunnel(
  db: Db, userId: string, gameweek: number, event: FunnelEvent,
): Promise<{ ok: boolean }> {
  try {
    const col = COLUMN[event];
    const now = new Date().toISOString();
    const { data: existing } = await db
      .from("fantasy_captain_funnel")
      .select("user_id")
      .eq("user_id", userId).eq("gameweek", gameweek).maybeSingle();

    if (!existing) {
      await db.from("fantasy_captain_funnel").insert({
        user_id: userId, gameweek, recommendation_generated: true,
        [col]: true, first_seen_at: now, updated_at: now,
      });
    } else {
      await db.from("fantasy_captain_funnel")
        .update({ [col]: true, updated_at: now })
        .eq("user_id", userId).eq("gameweek", gameweek);
    }
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
