import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { blocks, type NotifyPriority } from "@/lib/notifyPriority";

/**
 * Server-side push fan-out. Respects opt-in, dedups per (user, key) via
 * notification_log (so a daily push lands at most once), then delivers via the
 * generalised send-push Edge Function. Best-effort — never throws.
 *
 * Native only today (iOS device tokens). Web push reaches the web majority once
 * the service-worker + VAPID path is built; this helper is the channel-agnostic
 * seam, so that addition is a delivery-layer change, not a caller change.
 */
export async function notifyUsers(opts: {
  userIds: string[];
  title: string;
  body: string;
  url?: string;
  /** Per-user dedup key, e.g. "wc-mastermind:2026-06-22". */
  dedupeKey: string;
  /** Default true — only send to profiles with notifications_opt_in = true. */
  requireOptIn?: boolean;
  /**
   * How much this send is allowed to interrupt. Default routine.
   *
   * Only matters alongside minGapMinutes: a "breaking" send ignores routine
   * traffic inside its window, so a scheduled game reminder can no longer
   * silence actual news. A routine send is still blocked by everything.
   */
  priority?: NotifyPriority;
  /**
   * Skip anyone who has received a notification of EQUAL OR HIGHER priority in
   * the last this-many minutes.
   *
   * A per-user floor across every notification type, because each cron only
   * knows its own limits and the user experiences the sum. On 5 Aug one person
   * had the debate push at 07:30, the daily game at 11:30, a debate reminder at
   * 11:43, then two club stories seventeen seconds apart at 12:17 — five things
   * before lunch, none of which broke its own rules.
   *
   * Off by default so nothing changes for callers that have not opted in;
   * a caller that sets it accepts that some recipients are dropped rather than
   * queued, which is correct for news (it will be stale by the time they are
   * free) and would be wrong for something that must arrive.
   */
  minGapMinutes?: number;
  /**
   * A shorter floor against EVERYTHING, whatever its priority.
   *
   * Priority stops routine traffic silencing news for hours; this stops the two
   * landing in the same minute. Being allowed to interrupt is not the same as
   * being allowed to buzz someone twice in thirty seconds.
   */
  minGapAnyMinutes?: number;
}): Promise<{ targeted: number; skippedRecent?: number }> {
  try {
    const svc = createServiceClient();
    // notification_log isn't in the generated Database types until migration 56
    // is applied + types regenerated — untyped handle for those calls only.
    const raw = svc as unknown as SupabaseClient;

    let ids = Array.from(new Set(opts.userIds)).filter(Boolean);
    if (!ids.length) return { targeted: 0 };

    // 1. Opt-in filter.
    if (opts.requireOptIn !== false) {
      const { data } = await svc
        .from("profiles")
        .select("id")
        .in("id", ids)
        .eq("notifications_opt_in", true);
      const ok = new Set((data ?? []).map((r) => r.id));
      ids = ids.filter((i) => ok.has(i));
      if (!ids.length) return { targeted: 0 };
    }

    // 2. Per-user floors. Two windows: a long one against sends this cannot
    //    outrank, and a short one against absolutely anything.
    let skippedRecent = 0;
    const priority: NotifyPriority = opts.priority ?? "routine";
    const longGap = opts.minGapMinutes ?? 0;
    const anyGap = opts.minGapAnyMinutes ?? 0;
    if (longGap > 0 || anyGap > 0) {
      const widest = Math.max(longGap, anyGap);
      const since = new Date(Date.now() - widest * 60_000).toISOString();
      const { data: recent } = await raw
        .from("notification_log")
        .select("user_id, key, sent_at")
        .in("user_id", ids)
        .gte("sent_at", since);

      const now = Date.now();
      const busy = new Set<string>();
      for (const r of (recent ?? []) as { user_id: string; key: string; sent_at: string }[]) {
        const agoMin = (now - new Date(r.sent_at).getTime()) / 60_000;
        // Anything at all, very recently.
        if (anyGap > 0 && agoMin < anyGap) { busy.add(r.user_id); continue; }
        // Otherwise only things this send cannot outrank.
        if (longGap > 0 && agoMin < longGap && blocks(r.key, priority)) busy.add(r.user_id);
      }
      const before = ids.length;
      ids = ids.filter((i) => !busy.has(i));
      skippedRecent = before - ids.length;
      if (!ids.length) return { targeted: 0, skippedRecent };
    }

    // 3. Dedup against notification_log for this key.
    const { data: sentRows } = await raw
      .from("notification_log")
      .select("user_id")
      .eq("key", opts.dedupeKey)
      .in("user_id", ids);
    const alreadySent = new Set((sentRows ?? []).map((r: { user_id: string }) => r.user_id));
    const fresh = ids.filter((i) => !alreadySent.has(i));
    if (!fresh.length) return { targeted: 0 };

    // 3. Log BEFORE delivery — a retry after a partial failure won't double-send.
    const { error: logErr } = await raw
      .from("notification_log")
      .insert(fresh.map((user_id) => ({ user_id, key: opts.dedupeKey })));
    if (logErr) {
      console.error("[notify] notification_log insert failed:", logErr);
      return { targeted: 0 };
    }

    // 4. Deliver via the Edge Function (userIds targeting mode).
    const fnUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-push`;
    const res = await fetch(fnUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ userIds: fresh, title: opts.title, body: opts.body, url: opts.url }),
    });
    if (!res.ok) {
      console.error("[notify] send-push function returned", res.status, await res.text().catch(() => ""));
    }

    return { targeted: fresh.length, skippedRecent };
  } catch (err) {
    console.error("[notify] notifyUsers failed:", err);
    return { targeted: 0 };
  }
}
