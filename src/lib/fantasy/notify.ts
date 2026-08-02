import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { createNotification } from "@/lib/notifications";
import { fantasyAllowed } from "@/lib/fantasy/flag";

/**
 * The ONE seam every fantasy notification goes through (founder, 2 Aug). It does
 * three things the raw notifyUsers() didn't:
 *
 *  1. A single kill-switch. FANTASY_NOTIFY_ENABLED must be "true" or nothing
 *     sends — so the whole notification layer ships DARK and goes live by flipping
 *     one env var, not by editing code.
 *  2. A per-recipient fantasy-gate re-check. Even with the switch on, a user only
 *     gets notified if fantasyAllowed(them) — so while Fantasy is founder-gated
 *     only the allowlist can be reached; a stray squad row for a real user can't
 *     leak a push. When the launch env flag flips true, fantasyAllowed opens to
 *     everyone and this becomes a no-op, exactly as intended.
 *  3. Both channels from one call. It writes the in-app INBOX row (mig 222) AND
 *     the native push, gated by ONE notification_log claim so the two never
 *     diverge (push and inbox are the same event, deduped together).
 *
 * Best-effort, never throws — a notification must never fail the action it rides.
 */
export async function notifyFantasy(opts: {
  userIds: string[];
  title: string;
  body: string;
  /** Deep link; defaults to the Fantasy home. */
  url?: string;
  /** Per-(user,key) dedupe — one delivery ever, e.g. "fantasy-transfer:<uid>:<gw>". */
  dedupeKey: string;
  /** Inbox row type (renders via the inbox's generic title/body branch). */
  type: string;
  actorId?: string | null;
  subjectType?: string | null;
  subjectId?: string | null;
}): Promise<{ targeted: number }> {
  try {
    if (process.env.FANTASY_NOTIFY_ENABLED !== "true") return { targeted: 0 };
    const url = opts.url ?? "/fantasy";
    const svc = createServiceClient();
    // notification_log post-dates the generated types — untyped handle for it.
    const raw = svc as unknown as SupabaseClient;

    // Recipients: dedupe, drop falsy, and re-check the fantasy gate per user.
    const ids = Array.from(new Set(opts.userIds)).filter(Boolean).filter((id) => fantasyAllowed(id));
    if (!ids.length) return { targeted: 0 };

    // ONE notification_log claim gates inbox + push together, so they never diverge.
    const { data: sent } = await raw
      .from("notification_log").select("user_id").eq("key", opts.dedupeKey).in("user_id", ids);
    const already = new Set(((sent ?? []) as { user_id: string }[]).map((r) => r.user_id));
    const fresh = ids.filter((i) => !already.has(i));
    if (!fresh.length) return { targeted: 0 };

    const { error: logErr } = await raw
      .from("notification_log").insert(fresh.map((user_id) => ({ user_id, key: opts.dedupeKey })));
    if (logErr) { console.error("[fantasy:notify] notification_log insert failed:", logErr); return { targeted: 0 }; }

    // In-app inbox row for every fresh recipient — in-app, so no push opt-in needed.
    await Promise.all(fresh.map((uid) => createNotification({
      userId: uid, type: opts.type, actorId: opts.actorId ?? null,
      subjectType: opts.subjectType ?? null, subjectId: opts.subjectId ?? null,
      title: opts.title, body: opts.body, url, dedupeKey: opts.dedupeKey,
    })));

    // Push only to the opt-in subset (native device tokens).
    const { data: optRows } = await svc
      .from("profiles").select("id").in("id", fresh).eq("notifications_opt_in", true);
    const optIds = ((optRows ?? []) as { id: string }[]).map((r) => r.id);
    if (optIds.length) {
      const fnUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-push`;
      await fetch(fnUrl, {
        method: "POST",
        headers: { authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ userIds: optIds, title: opts.title, body: opts.body, url }),
      }).then((r) => { if (!r.ok) console.error("[fantasy:notify] send-push returned", r.status); })
        .catch((e) => console.error("[fantasy:notify] send-push failed:", e));
    }
    return { targeted: fresh.length };
  } catch (err) {
    console.error("[fantasy:notify] failed:", err);
    return { targeted: 0 };
  }
}
