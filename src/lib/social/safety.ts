import "server-only";
/**
 * Social Phase 5a — report, block, mute. Everything here degrades gracefully
 * pre-migration (253): a missing table surfaces as a friendly 503 on a write,
 * or an empty result on a read, never a crash — same discipline the rest of
 * the social stack uses for an unapplied migration (see feed.ts's bookmark/
 * pin functions).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "@/lib/fantasy/server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", any>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REPORT_SUBJECT_TYPES = new Set(["post", "comment", "profile"]);
const REASON_MAX = 200;

// ── Report (AC2) ──────────────────────────────────────────────────────────

/** File a report. One per (reporter, subject) — a resubmit just refreshes the
 *  reason (upsert on the unique index, migration 253). subjectId is validated
 *  as a uuid shape for every subject type — post/comment ids are uuids, and
 *  so is a profile id. */
export async function submitReport(db: Db, reporterId: string, body: unknown): Promise<{ ok: true }> {
  const b = (body ?? {}) as { subjectType?: unknown; subjectId?: unknown; reason?: unknown };
  const subjectType = typeof b.subjectType === "string" ? b.subjectType : "";
  const subjectId = typeof b.subjectId === "string" ? b.subjectId.trim() : "";
  if (!REPORT_SUBJECT_TYPES.has(subjectType) || !UUID_RE.test(subjectId)) throw new HttpError(400, "bad report");
  const reason = typeof b.reason === "string" && b.reason.trim() ? b.reason.trim().slice(0, REASON_MAX) : null;

  const { error } = await db.from("social_reports").upsert(
    { reporter_id: reporterId, subject_type: subjectType, subject_id: subjectId, reason },
    { onConflict: "reporter_id,subject_type,subject_id" },
  );
  if (error) throw new HttpError(503, "Reporting isn't available right now");
  return { ok: true };
}

// ── Block (AC3) ───────────────────────────────────────────────────────────

export async function blockUser(db: Db, blockerId: string, targetId: unknown): Promise<{ ok: true }> {
  const blockedId = typeof targetId === "string" ? targetId.trim() : "";
  if (!blockedId || !UUID_RE.test(blockedId)) throw new HttpError(400, "bad block");
  if (blockedId === blockerId) throw new HttpError(400, "You can't block yourself");

  const { error } = await db.from("user_blocks").upsert(
    { blocker_id: blockerId, blocked_id: blockedId },
    { onConflict: "blocker_id,blocked_id" },
  );
  if (error) throw new HttpError(503, "Blocking isn't available right now");

  // Sever the follow graph both ways (AC3). Best-effort: a block has already
  // landed above, so a follow-cleanup hiccup shouldn't roll that back or fail
  // the request — the stray follow row is harmless (hydrateEvents' block
  // filter already hides both people's content from each other regardless).
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).from("user_follows").delete().or(
      `and(follower_id.eq.${blockerId},followee_id.eq.${blockedId}),and(follower_id.eq.${blockedId},followee_id.eq.${blockerId})`,
    );
  } catch (e) { console.error("[social:block] follow cleanup failed:", e); }

  return { ok: true };
}

export async function unblockUser(db: Db, blockerId: string, targetId: unknown): Promise<{ ok: true }> {
  const blockedId = typeof targetId === "string" ? targetId.trim() : "";
  if (!blockedId) throw new HttpError(400, "bad block");
  const { error } = await db.from("user_blocks").delete().eq("blocker_id", blockerId).eq("blocked_id", blockedId);
  if (error) throw new HttpError(503, "Blocking isn't available right now");
  return { ok: true };
}

// ── Mute (AC4) ────────────────────────────────────────────────────────────

export async function muteUser(db: Db, muterId: string, targetId: unknown): Promise<{ ok: true }> {
  const mutedId = typeof targetId === "string" ? targetId.trim() : "";
  if (!mutedId || !UUID_RE.test(mutedId)) throw new HttpError(400, "bad mute");
  if (mutedId === muterId) throw new HttpError(400, "You can't mute yourself");
  const { error } = await db.from("user_mutes").upsert(
    { blocker_id: muterId, blocked_id: mutedId },
    { onConflict: "blocker_id,blocked_id" },
  );
  if (error) throw new HttpError(503, "Muting isn't available right now");
  return { ok: true };
}

export async function unmuteUser(db: Db, muterId: string, targetId: unknown): Promise<{ ok: true }> {
  const mutedId = typeof targetId === "string" ? targetId.trim() : "";
  if (!mutedId) throw new HttpError(400, "bad mute");
  const { error } = await db.from("user_mutes").delete().eq("blocker_id", muterId).eq("blocked_id", mutedId);
  if (error) throw new HttpError(503, "Muting isn't available right now");
  return { ok: true };
}

// ── Read-side filtering (AC3/AC4) ────────────────────────────────────────

/** Every actor id `viewerId` has blocked or been blocked BY (bidirectional,
 *  AC3) — deliberately WITHOUT mutes folded in, unlike hiddenActorIds below.
 *  This is the "never appears, anywhere — search, autocomplete, rosters"
 *  rule (Phase 1A mention-autocomplete, master brief §3/§2): a mute only
 *  ever hides FEED/CHAT CONTENT from the muter (AC4), it was never meant to
 *  make someone invisible to search or un-mentionable — only a block does
 *  that. Empty set for a guest or a pre-migration table. */
export async function blockedActorIds(db: Db, viewerId: string | null): Promise<Set<string>> {
  const blocked = new Set<string>();
  if (!viewerId) return blocked;
  const { data, error } = await db.from("user_blocks").select("blocker_id, blocked_id")
    .or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`);
  if (!error) {
    for (const r of (data ?? []) as { blocker_id: string; blocked_id: string }[]) {
      blocked.add(r.blocker_id === viewerId ? r.blocked_id : r.blocker_id);
    }
  }
  return blocked;
}

/** Every actor id that should be hidden from `viewerId`'s feeds/chat: every
 *  blockedActorIds() result, PLUS anyone they've muted (one-directional —
 *  AC4, the muted user's own view is unaffected). Two small batched queries,
 *  never N+1 — the same shape whether this batch is a feed page, a post
 *  detail, or a league chat window. Empty set for a guest (viewerId null) or
 *  when the tables aren't migrated yet (each query is independently
 *  tolerant of that). */
export async function hiddenActorIds(db: Db, viewerId: string | null): Promise<Set<string>> {
  if (!viewerId) return new Set<string>();

  const [blocked, mutesRes] = await Promise.all([
    blockedActorIds(db, viewerId),
    db.from("user_mutes").select("blocked_id").eq("blocker_id", viewerId),
  ]);

  const hidden = new Set(blocked);
  if (!mutesRes.error) {
    for (const r of (mutesRes.data ?? []) as { blocked_id: string }[]) hidden.add(r.blocked_id);
  }
  return hidden;
}

/** The viewer's block/mute state on ONE profile — for the profile page's
 *  "You've blocked this manager" banner and the safety menu's initial toggle
 *  state. False/false for your own profile, a guest, or a pre-migration
 *  table (never throws). */
export async function blockStatus(
  db: Db, viewerId: string | null, profileUserId: string,
): Promise<{ blocked: boolean; muted: boolean }> {
  if (!viewerId || viewerId === profileUserId) return { blocked: false, muted: false };
  try {
    const [{ data: b }, { data: m }] = await Promise.all([
      db.from("user_blocks").select("blocker_id").eq("blocker_id", viewerId).eq("blocked_id", profileUserId).maybeSingle(),
      db.from("user_mutes").select("blocker_id").eq("blocker_id", viewerId).eq("blocked_id", profileUserId).maybeSingle(),
    ]);
    return { blocked: !!b, muted: !!m };
  } catch {
    return { blocked: false, muted: false };
  }
}
