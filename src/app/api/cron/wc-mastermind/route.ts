import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyUsers } from "@/lib/notify";

/**
 * Hourly cron: the World Cup Mastermind daily-drop push.
 *
 * Send-time personalisation, not a blast: each opted-in user is notified at
 * THEIR habitual hour (profiles.active_hour_utc, inferred from play history by
 * scripts/compute-send-times.mjs). This route runs every hour and, on each run,
 * targets only the users whose active hour == the current UTC hour. Over 24
 * runs every opted-in user is reached once, at the time they actually play.
 * Users with no inferred hour fall back to FALLBACK_HOUR.
 *
 * Dedup is per-day via notification_log key "wc-mastermind:<date>", so a user
 * is pinged at most once per day's pack regardless of cron retries.
 *
 * Safety rails:
 *  - WC_MASTERMIND_PUSH_ENABLED must be "true", else no-op (guards seed/test
 *    accounts and lets you stage the rollout).
 *  - Only runs if today's daily WC pack is actually published.
 *  - Hard cap of 2000 targeted users per run.
 *
 * Auth: Vercel cron sends `Authorization: Bearer ${CRON_SECRET}`.
 */
// Evening (UK-anchored) — the assumed downtime for users with no inferred hour.
// Must match EVENING_HOUR in scripts/compute-send-times.mjs so never-played
// users and snapped-to-evening users land in the same bucket.
const FALLBACK_HOUR = 19;
const MAX_PER_RUN = 2000;

// A cron must never act on cached reads: without this, Vercel's durable Data
// Cache can pin the service-client GETs (today's pack, target users) between
// deploys and the push would fire with stale data.
export const fetchCache = "force-no-store";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (process.env.WC_MASTERMIND_PUSH_ENABLED !== "true") {
    return NextResponse.json({ enabled: false, sent: 0 });
  }

  const svc = createServiceClient();
  // active_hour_utc isn't in the generated types until migration 56 is applied
  // + types regenerated — untyped handle for the profiles filters that use it.
  const raw = svc as unknown as SupabaseClient;
  const now = new Date();
  const hour = now.getUTCHours();
  const today = now.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)

  // Today's daily WC pack must exist + be published before we ping anyone.
  // Filter at the DB level (metadata @> {daily,date}) — there are now hundreds
  // of published packs (club packs etc.), so an unordered .limit() would often
  // miss today's daily pack and no-op with "no-pack-today".
  const { data: packs } = await raw
    .from("quiz_packs")
    .select("id, name, metadata")
    .eq("status", "published")
    .contains("metadata", { daily: true, date: today })
    .order("created_at", { ascending: false })
    .limit(10);
  const todaysPack = ((packs ?? []) as { id: string; name: string; metadata: unknown }[]).find((p) => {
    const m = (p.metadata ?? {}) as { series?: string };
    return (m.series ?? "wc2026") === "wc2026";
  });
  if (!todaysPack) {
    return NextResponse.json({ enabled: true, sent: 0, reason: "no-pack-today" });
  }

  // Opted-in users whose habitual hour is now (or fallback bucket if unset).
  // active_hour_utc == hour, OR (active_hour_utc is null AND hour == FALLBACK_HOUR).
  const targets = new Set<string>();
  {
    const { data: exact } = await raw
      .from("profiles")
      .select("id")
      .eq("notifications_opt_in", true)
      .eq("active_hour_utc", hour)
      .limit(MAX_PER_RUN);
    (exact ?? []).forEach((r: { id: string }) => targets.add(r.id));

    if (hour === FALLBACK_HOUR && targets.size < MAX_PER_RUN) {
      const { data: noHour } = await raw
        .from("profiles")
        .select("id")
        .eq("notifications_opt_in", true)
        .is("active_hour_utc", null)
        .limit(MAX_PER_RUN - targets.size);
      (noHour ?? []).forEach((r: { id: string }) => targets.add(r.id));
    }
  }

  if (!targets.size) {
    return NextResponse.json({ enabled: true, sent: 0, hour, reason: "no-targets-this-hour" });
  }

  const { targeted } = await notifyUsers({
    userIds: Array.from(targets),
    title: "World Cup Mastermind Daily is live 🧠",
    body: "Draft your XI Now! Nail it and top the board!",
    url: "/38-0/wc",
    dedupeKey: `wc-mastermind:${today}`,
  });

  return NextResponse.json({ enabled: true, hour, targeted, pack: todaysPack.name });
}
