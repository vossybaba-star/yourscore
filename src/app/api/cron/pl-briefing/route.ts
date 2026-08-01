import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { buildBriefing } from "@/lib/pl/briefingBuild";
import { upsertBroadcastNotification } from "@/lib/notifications";
import { notifyUsers } from "@/lib/notify";

/**
 * GET /api/cron/pl-briefing — compile the Daily Briefing and tell everyone.
 * 18:00 London, daily. Bearer CRON_SECRET.
 *
 * DST: Vercel crons are UTC, so this is registered at BOTH 17:00 and 18:00 UTC
 * and only the run that lands on 18:00 *London* proceeds. Exactly one fires in
 * either half of the year. Same pattern as daily-debate-push.
 *
 * Order matters. The briefing is built and STORED first, then the notification
 * goes out — a push that lands before the row exists sends readers to an empty
 * page, and that is the one failure a reader actually sees.
 *
 * Safe to re-run: the briefing row upserts by date, the inbox row upserts on its
 * dedupe key, and notifyUsers dedupes per (user, key). A retry, a DST double
 * fire, or a manual run cannot double-send.
 *
 * `?dry=1` builds and stores the briefing and reports exactly who WOULD be
 * notified, without sending anything. Use it to check the copy against a real
 * briefing before a real send.
 *
 * Kill switch: PL_BRIEFING_PUSH_ENABLED=false stops the notification. The
 * briefing itself still builds — the tab keeps working, it just goes quiet.
 */

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The London hour this is meant to land on. */
const SEND_HOUR = 18;

/** Hour (0–23) in Europe/London right now, DST-correct via Intl. */
function londonHour(): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London", hour: "2-digit", hour12: false,
    }).format(new Date()),
  );
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // `force=1` runs off-hour, for building a briefing by hand.
  const force = req.nextUrl.searchParams.get("force") === "1";
  const hour = londonHour();
  if (!force && hour !== SEND_HOUR) {
    return NextResponse.json({ skipped: "off-hour", londonHour: hour });
  }

  /**
   * A MANUAL call never sends. The scheduled run always does.
   *
   * The guard exists because a hand-run of this route — made to check the
   * off-hour guard, at 18:00 London, without the dry flag — delivered a real
   * push to 298 users with a broken headline pointing at a page that wasn't
   * deployed yet. The clock deciding whether a request sends was the bug.
   *
   * The SIGNAL is `send=1`, carried in the cron path in vercel.json, because
   * that is something we control and can read here. The first version keyed off
   * an `x-vercel-cron` request header, which Vercel does not actually send — so
   * the scheduler's own invocation was classified as manual and silently
   * suppressed. The 31 July briefing built correctly and notified nobody.
   *
   * The header is still accepted if it ever shows up, but nothing depends on it.
   */
  const scheduled =
    req.nextUrl.searchParams.get("send") === "1" || !!req.headers.get("x-vercel-cron");
  const confirmed = req.nextUrl.searchParams.get("confirm") === "send";
  const dry = req.nextUrl.searchParams.get("dry") === "1" || !(scheduled || confirmed);

  const db = createServiceClient() as unknown as SupabaseClient;
  const { briefing, issue, rejected } = await buildBriefing(db);

  if (!briefing) {
    console.error("[cron/pl-briefing] nothing to publish", issue);
    return NextResponse.json({ ok: false, issue }, { status: 502 });
  }

  const title = briefing.subhead;
  const body = "Today's Daily Briefing, in five stories.";
  const url = "/matchweek/briefing";
  const dedupeKey = `pl-briefing:${briefing.date}`;

  const pushOff = process.env.PL_BRIEFING_PUSH_ENABLED === "false";
  let targeted = 0;
  let notified: string;

  if (pushOff) {
    notified = "disabled via PL_BRIEFING_PUSH_ENABLED=false";
  } else {
    // The inbox row is for EVERYONE, including web users with no device token,
    // so it goes in before the opted-in push narrows the audience. Wrapped: a
    // failed inbox write must not cost us the push.
    if (!dry) {
      try {
        await upsertBroadcastNotification({ type: "pl_briefing", title, body, url, dedupeKey });
      } catch (err) {
        console.error("[cron/pl-briefing] inbox broadcast failed:", err);
      }
    }

    // Everyone opted in. notifyUsers re-confirms opt-in and dedupes per
    // (user, key), so this stays safe to fire twice.
    const { data: optedIn } = await db
      .from("profiles").select("id").eq("notifications_opt_in", true);
    const userIds = (optedIn ?? []).map((r) => r.id as string);

    if (dry) {
      notified = scheduled || confirmed
        ? `dry run — would target ${userIds.length} opted-in users`
        : `not sent — manual call. ${userIds.length} opted-in users would be targeted. Add confirm=send to actually deliver.`;
    } else if (!userIds.length) {
      notified = "no opted-in users";
    } else {
      ({ targeted } = await notifyUsers({ userIds, title, body, url, dedupeKey }));
      notified = `sent to ${targeted}`;
    }
  }

  /**
   * At the send hour, sending nothing is an INCIDENT, not a quiet outcome.
   *
   * The 31 July run built a perfect briefing and notified nobody, and it looked
   * like a success in every log line — ok:true, a date, five stories. The only
   * evidence was an empty notification_log a day later, found because the
   * founder asked why his phone was quiet. Anything that silently does nothing
   * at the moment it exists to do something has to say so loudly.
   */
  const shouldHaveSent = !force && !dry && !pushOff;
  const silentlyQuiet = shouldHaveSent && targeted === 0;
  if (silentlyQuiet) {
    console.error(`[cron/pl-briefing] SENT NOTHING at the send hour — ${notified}`);
  }

  return NextResponse.json({
    ok: true,
    date: briefing.date,
    compiledBy: briefing.compiledBy,
    rejected: rejected ?? 0,
    notification: { title, body, url, dedupeKey, targeted, notified },
    // Present only when a scheduled run reached nobody. Absent on a healthy run,
    // so it stands out in a log rather than blending into the normal shape.
    alert: silentlyQuiet ? "scheduled run notified nobody" : undefined,
    stories: briefing.stories.map((s) => ({ source: s.source, desks: s.desks, title: s.title })),
    issue,
  });
}
