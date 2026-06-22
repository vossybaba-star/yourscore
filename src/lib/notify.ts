import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";

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
}): Promise<{ targeted: number }> {
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

    // 2. Dedup against notification_log for this key.
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

    return { targeted: fresh.length };
  } catch (err) {
    console.error("[notify] notifyUsers failed:", err);
    return { targeted: 0 };
  }
}
