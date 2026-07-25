import "server-only";
/**
 * The halftime ↔ fantasy link (founder-locked 22 Jul): finish a halftime quiz
 * with a good score and it feeds your fantasy game, the same way the weekly
 * round does — credits into the bank, overflow cashed as points.
 *
 * The timing is what makes this clean: halftime happens AFTER the fantasy
 * deadline, so nothing here can touch the week in play. Credits bank toward
 * NEXT gameweek; overflow points land on the current (locked) entry's
 * cash_points, which is re-score-proof by construction.
 *
 * Rules (measured in season-sim before building — edge flat at 22.6%, paid
 * hits DROP 11.3 → 7.5/season, dead slots unchanged):
 *   - a completed halftime pack at ≥ GOOD_SCORE (7/10) mints 1 credit
 *   - capped at HT_CAP (2) mints per gameweek
 *   - squad holders only — a halftime-only player is untouched (no squad, no sweep)
 *   - idempotent per attempt: claimed in notification_log before minting, the
 *     same claim-before-effect idiom as every other send/mint in the tick
 *
 * Zero coupling to the halftime branch's code: packs land in shared quiz_packs
 * with the fixture linkage in metadata.halftime; attempts land in shared
 * quiz_attempts. This sweep reads those tables and nothing else.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyUsers } from "@/lib/notify";
import { cashOverflow } from "./engine";
import type { SeasonGw } from "./season";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", any>;

const GOOD_SCORE = 7;  // of the halftime pack's 10 questions
const HT_CAP = 2;      // mints per gameweek — a big Saturday can't flood the bank

export async function halftimeEarn(db: Db, gw: SeasonGw): Promise<{ minted: number }> {
  // Attempts inside the gameweek's match window (+1 day for late kickoffs).
  const windowEnd = new Date(new Date(`${gw.window_end}T00:00:00Z`).getTime() + 48 * 3600_000).toISOString();
  const { data: attempts } = await db.from("quiz_attempts")
    .select("id, user_id, pack_id, correct_count, completed_at")
    .gte("completed_at", `${gw.window_start}T00:00:00Z`).lte("completed_at", windowEnd)
    .gte("correct_count", GOOD_SCORE).range(0, 9999);
  const rows = (attempts ?? []) as { id: string; user_id: string; pack_id: string; correct_count: number }[];
  if (!rows.length) return { minted: 0 };

  // Halftime packs only — the linkage lives in quiz_packs.metadata.halftime.
  const packIds = Array.from(new Set(rows.map((r) => r.pack_id)));
  const { data: packs } = await db.from("quiz_packs")
    .select("id, metadata").in("id", packIds).range(0, 9999);
  const halftimePacks = new Set(((packs ?? []) as { id: string; metadata: { halftime?: unknown } | null }[])
    .filter((p) => p.metadata && typeof p.metadata === "object" && "halftime" in p.metadata)
    .map((p) => p.id));
  const qualifying = rows.filter((r) => halftimePacks.has(r.pack_id));
  if (!qualifying.length) return { minted: 0 };

  // Squad holders only.
  const userIds = Array.from(new Set(qualifying.map((r) => r.user_id)));
  const { data: squads } = await db.from("fantasy_squads")
    .select("user_id, credits, version").in("user_id", userIds);
  const squadOf = new Map(((squads ?? []) as { user_id: string; credits: number; version: number }[])
    .map((s) => [s.user_id, s]));

  let minted = 0;
  for (const a of qualifying) {
    const squad = squadOf.get(a.user_id);
    if (!squad) continue; // plays halftime quizzes, not fantasy — untouched

    // Per-gameweek cap: count this user's existing halftime claims for this gw.
    const { data: prior } = await db.from("notification_log")
      .select("key").eq("user_id", a.user_id).like("key", `fantasy-ht:${gw.gw}:%`);
    if ((prior?.length ?? 0) >= HT_CAP) continue;

    // Claim THIS attempt before any effect — a re-sweep can never double-mint.
    const { error: claimErr } = await db.from("notification_log")
      .insert({ user_id: a.user_id, key: `fantasy-ht:${gw.gw}:${a.id}` });
    if (claimErr) continue; // already claimed (or racing) — skip

    const { credits, points } = cashOverflow(squad.credits, 1);
    const { data: updated } = await db.from("fantasy_squads")
      .update({ credits, version: squad.version + 1 })
      .eq("user_id", a.user_id).eq("version", squad.version).select("version");
    if (!updated?.length) continue; // squad moved under us — next sweep re-reads (claim stands: one attempt, one try)
    squad.credits = credits; squad.version += 1;

    if (points > 0) {
      // Bank full → the mint cashes onto the CURRENT locked entry, like the round's overflow.
      const { data: entry } = await db.from("fantasy_entries")
        .select("cash_points").eq("user_id", a.user_id).eq("gw", gw.gw).maybeSingle();
      if (entry) await db.from("fantasy_entries")
        .update({ cash_points: (entry.cash_points ?? 0) + points })
        .eq("user_id", a.user_id).eq("gw", gw.gw);
    }
    minted++;

    void notifyUsers({
      userIds: [a.user_id],
      title: "Halftime quiz cashed in",
      body: points > 0
        ? `${a.correct_count}/10 at halftime — your bank was full, so it paid ${points} points instead.`
        : `${a.correct_count}/10 at halftime banked you a transfer for next gameweek.`,
      url: "/fantasy",
      dedupeKey: `fantasy-ht-push:${gw.gw}:${a.id}`,
    }).catch(() => {});
  }
  return { minted };
}
