import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { sendEngagementDigestEmail } from "@/lib/email/senders";
import { ENGAGEMENT_TYPES, startOfUtcDayIso, displayNameOf } from "@/lib/engagement";

/**
 * Daily cron: the engagement digest for people who don't have the app (founder,
 * 4 Aug). Everyone gets their first 2 engagement events a day as individual
 * emails (see lib/engagement); this cron wraps EVERYTHING ELSE that landed today
 * into ONE email — likes, replies and reactions they didn't get pinged for, plus
 * a rundown of what the managers they follow got up to.
 *
 * Cohort, built the same way gameday's email fallback is:
 *   • Only users with HELD engagement rows today (notifications.emailed_at IS NULL).
 *   • Only NON-app users (no device_tokens row) — push already reached the rest.
 *   • Suppression-aware, and once-per-day via a notification_log claim inserted
 *     BEFORE send, so a re-run can't double-email.
 *
 * Ships DARK behind ENGAGEMENT_EMAILS_ENABLED. Auth: Bearer ${CRON_SECRET}.
 */

const MAX_SENDS_PER_RUN = 400;
const DIGEST_PREFIX = "eng-digest:";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (process.env.ENGAGEMENT_EMAILS_ENABLED !== "true") {
    return NextResponse.json({ enabled: false, sent: 0, note: "Set ENGAGEMENT_EMAILS_ENABLED=true to activate" });
  }

  const db = createServiceClient() as unknown as SupabaseClient;
  const dayStart = startOfUtcDayIso();
  const dayKey = `${DIGEST_PREFIX}${dayStart.slice(0, 10)}`;

  // 1. Held engagement rows for today, across all users.
  const { data: heldRows } = await db
    .from("notifications")
    .select("user_id, type, like_count, actor_id")
    .in("type", ENGAGEMENT_TYPES as unknown as string[])
    .is("emailed_at", null)
    .not("user_id", "is", null)
    .gte("created_at", dayStart)
    .limit(1000);
  const held = (heldRows ?? []) as { user_id: string; type: string; like_count: number; actor_id: string | null }[];
  if (!held.length) return NextResponse.json({ enabled: true, sent: 0, note: "nothing held" });
  const capped = held.length >= 1000;

  // Group per recipient.
  const byUser = new Map<string, { likes: number; reactions: number; replies: number }>();
  for (const r of held) {
    const g = byUser.get(r.user_id) ?? { likes: 0, reactions: 0, replies: 0 };
    if (r.type === "comment_like") g.likes += Math.max(1, r.like_count ?? 1);
    else if (r.type === "feed_reaction") g.reactions += Math.max(1, r.like_count ?? 1);
    else if (r.type === "comment_reply") g.replies += 1;
    byUser.set(r.user_id, g);
  }
  const candidateIds = Array.from(byUser.keys());

  // 2. Drop app users (push already reached them) in one batch.
  const { data: toks } = await db.from("device_tokens").select("user_id").in("user_id", candidateIds);
  const hasToken = new Set(((toks ?? []) as { user_id: string }[]).map((r) => r.user_id));
  const targets = candidateIds.filter((id) => !hasToken.has(id));

  // 3. Drop anyone already digested today (a re-run must not double-send).
  const { data: sentRows } = await db
    .from("notification_log").select("user_id").eq("key", dayKey).in("user_id", targets);
  const alreadySent = new Set(((sentRows ?? []) as { user_id: string }[]).map((r) => r.user_id));

  let sent = 0;
  let stamped = 0;
  for (const userId of targets) {
    if (sent >= MAX_SENDS_PER_RUN) break;
    if (alreadySent.has(userId)) continue;

    // Deliverable email?
    const { data: u } = await db.auth.admin.getUserById(userId);
    const email = u?.user?.email;
    if (!email || !u.user?.email_confirmed_at) continue;
    const { data: sup } = await db.from("email_suppressions").select("email").eq("email", email).limit(1);
    if (((sup ?? []) as unknown[]).length > 0) continue;

    const g = byUser.get(userId)!;
    const activityLine = activitySentence(g);
    const feedHtml = await buildFeedHtml(db, userId, dayStart);

    // Claim BEFORE sending — a retry after a partial failure won't double-send.
    const { error: claimErr } = await db.from("notification_log").insert({ user_id: userId, key: dayKey });
    if (claimErr) continue;

    await sendEngagementDigestEmail({
      userId,
      email,
      activityLine,
      feedHtml,
      hasFeed: feedHtml.length > 0,
      url: "/fantasy/social",
    });
    sent++;

    // Stamp today's held rows for this user so they're never digested again.
    const { error: stampErr } = await db
      .from("notifications")
      .update({ emailed_at: new Date().toISOString() })
      .eq("user_id", userId)
      .in("type", ENGAGEMENT_TYPES as unknown as string[])
      .is("emailed_at", null)
      .gte("created_at", dayStart);
    if (!stampErr) stamped++;
  }

  return NextResponse.json({ enabled: true, sent, stamped, candidates: targets.length, capped });
}

/** A natural sentence from the day's counts. Always non-empty (caller guarantees
 *  at least one held row per user). "friend" house-style is n/a here. */
function activitySentence(g: { likes: number; reactions: number; replies: number }): string {
  const parts: string[] = [];
  if (g.likes) parts.push(`${g.likes} ${g.likes === 1 ? "like" : "likes"} on your comments`);
  if (g.reactions) parts.push(`${g.reactions} ${g.reactions === 1 ? "reaction" : "reactions"} on your posts`);
  if (g.replies) parts.push(`${g.replies} ${g.replies === 1 ? "reply" : "replies"}`);
  if (!parts.length) return "You picked up some new activity today.";
  const joined =
    parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `You picked up ${joined} today.`;
}

/** What the managers this user follows did today — a few lines, newest first.
 *  Empty string when they follow nobody or nobody moved. */
async function buildFeedHtml(db: SupabaseClient, userId: string, dayStart: string): Promise<string> {
  const { data: follows } = await db
    .from("user_follows").select("followee_id").eq("follower_id", userId).limit(200);
  const ids = ((follows ?? []) as { followee_id: string }[]).map((r) => r.followee_id);
  if (!ids.length) return "";

  const { data: evs } = await db
    .from("fantasy_feed_events")
    .select("actor_id, type, payload, created_at")
    .in("actor_id", ids)
    .gte("created_at", dayStart)
    .order("created_at", { ascending: false })
    .limit(6);
  const events = (evs ?? []) as { actor_id: string; type: string; payload: unknown }[];
  if (!events.length) return "";

  const rows: string[] = [];
  const nameCache = new Map<string, string>();
  for (const ev of events.slice(0, 4)) {
    let name = nameCache.get(ev.actor_id);
    if (!name) { name = await displayNameOf(db, ev.actor_id); nameCache.set(ev.actor_id, name); }
    rows.push(
      `<tr><td style="padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.05);font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:14.5px;line-height:20px;color:#c9d3ce;"><strong style="color:#ffffff;">${escapeHtml(name)}</strong> ${escapeHtml(feedVerb(ev.type, ev.payload))}</td></tr>`,
    );
  }

  return (
    `<tr><td class="px" style="padding:6px 40px 8px;"><p style="margin:0;font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:3px;color:#2dd4bf;font-weight:700;text-transform:uppercase;">In your feed today</p></td></tr>` +
    `<tr><td class="px" style="padding:0 40px 26px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join("")}</table></td></tr>`
  );
}

/** Short phrase for a feed event in the digest. No dashes (house style). */
function feedVerb(type: string, payload: unknown): string {
  const p = (payload ?? {}) as Record<string, unknown>;
  const text = (p.text as string | undefined)?.trim();
  switch (type) {
    case "post": return text ? `posted: "${text.length > 70 ? `${text.slice(0, 70)}…` : text}"` : "posted in the feed";
    case "transfer": return "made a transfer";
    case "captain": return "changed their captain";
    case "chip": return "played a chip";
    case "haul": return "banked a big gameweek";
    case "rank_jump": return "jumped up the rankings";
    case "squad_complete": return "finished their squad";
    case "squad_update": return "updated their squad";
    case "shortlist_add": return "added to their shortlist";
    default: return "was active in the feed";
  }
}

function escapeHtml(s: string): string {
  // Strip curly braces too: feed_html is injected into the template as a token
  // value, so a user post containing "{{x}}" would otherwise survive into the
  // final HTML and trip renderEmail's leftover-token guard, throwing the send.
  return s
    .replace(/[{}]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
