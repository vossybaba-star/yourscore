import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyUsers } from "@/lib/notify";
import { upsertBroadcastNotification } from "@/lib/notifications";
import { todaysDebate, ukToday } from "@/lib/debate";

// Service-role reads must never be pinned by Vercel's data cache — see CLAUDE.md §4.
export const fetchCache = "force-no-store";

/**
 * Daily push: today's Debate to everyone opted in, each morning (08:30 London).
 *
 * Mirrors the /debate card via `todaysDebate` (the row dated today, else the
 * most recent) so the push always matches what's live on the debate page.
 *
 * Timing / DST: same pattern as daily-game-push — vercel.json fires this at BOTH
 * 07:30 and 08:30 UTC and the route only proceeds at the 08:00 London hour, so
 * it lands 08:30 London year-round (BST and GMT). The off-hour fire sends nothing.
 *
 * Safety: active by default; set `DAILY_DEBATE_PUSH_ENABLED=false` in Vercel to
 * kill it without a code change. Authenticated with Bearer `CRON_SECRET`.
 * `notifyUsers` handles the opt-in filter + per-(user, key) dedupe, so a retry or
 * a double fire can never double-send.
 */

// Root-relative so the native tap handler (src/lib/push.ts — navigates only when
// url.startsWith("/")) opens it in-app. Lands on the Home tab and the Dashboard
// scrolls Today's Debate into view (see the `focus` effect in Dashboard.tsx).
const HOME_DEBATE_URL = "/?focus=debate";

/** Hour (0–23) in Europe/London right now, DST-correct via Intl. */
function londonHour(): number {
  const h = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    hour12: false,
  }).format(new Date());
  return Number(h);
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Active by default; the kill switch is DAILY_DEBATE_PUSH_ENABLED=false.
  if (process.env.DAILY_DEBATE_PUSH_ENABLED === "false") {
    return NextResponse.json({ enabled: false, note: "Disabled via DAILY_DEBATE_PUSH_ENABLED=false" });
  }
  // Only the 08:30 London slot proceeds (see DST note above).
  const hour = londonHour();
  if (hour !== 8) {
    return NextResponse.json({ skipped: "off-hour", londonHour: hour });
  }

  const svc = createServiceClient();
  const debate = await todaysDebate(svc);
  if (!debate) {
    return NextResponse.json({ enabled: true, targeted: 0, note: "no active debate" });
  }

  const day = ukToday();
  const debateTitle = "Today's debate 🗣️";
  const debateBody = `${debate.question} Vote and see how fans are split.`;

  // Inbox row for EVERYONE (stage 2), including web users with zero push
  // targets — so this must land before the opted-in early-return below.
  // Upserted against the dedupe_key unique index: a DST double-fire or retry
  // for the same day still leaves exactly one row. Wrapped so push always
  // proceeds regardless of this succeeding.
  try {
    await upsertBroadcastNotification({
      type: "daily_debate",
      title: debateTitle,
      body: debateBody,
      url: HOME_DEBATE_URL,
      dedupeKey: `daily-debate-push:${day}`,
    });
  } catch (err) {
    console.error("[daily-debate-push] inbox broadcast failed:", err);
  }

  // Everyone opted in. notifyUsers re-confirms opt-in, narrows to iOS device
  // tokens, and dedupes per (user, key) — safe to fire twice.
  const { data: optedIn } = await svc
    .from("profiles")
    .select("id")
    .eq("notifications_opt_in", true);
  const userIds = (optedIn ?? []).map((r) => r.id);
  if (!userIds.length) {
    return NextResponse.json({ enabled: true, targeted: 0, note: "no opted-in users" });
  }

  const { targeted } = await notifyUsers({
    userIds,
    title: debateTitle,
    body: debateBody,
    url: HOME_DEBATE_URL,
    dedupeKey: `daily-debate-push:${day}`,
  });

  return NextResponse.json({ enabled: true, day, debateId: debate.id, targeted });
}
