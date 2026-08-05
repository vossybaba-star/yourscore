import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyUsers } from "@/lib/notify";
import { createNotification } from "@/lib/notifications";
import { selectStories } from "@/lib/pl/briefing";
import { clubNewsKey, clubPushCopy, clubsInHeadline } from "@/lib/pl/clubNews";
import type { PlNewsFeed, PlNewsItem } from "@/lib/pl/news";

/**
 * GET /api/cron/club-news — push a club's big stories to that club's fans.
 *
 * Runs every 30 minutes, offset behind /api/cron/pl-news so it reads a feed doc
 * that was refreshed minutes ago rather than fetching nine desks again.
 *
 * ── The three things stopping this becoming spam ──────────────────────────
 * 1. CORROBORATION. Only a story multiple desks are running qualifies, reusing
 *    the Daily Briefing's clustering. Arsenal alone published 47 stories in a
 *    day; 5 of them cleared this bar.
 * 2. A DAILY CAP per fanbase, counted from notification_log, so a busy club
 *    cannot out-shout a quiet one.
 * 3. WAKING HOURS only. This fires 48 times a day and nobody wants transfer
 *    gossip at 4am.
 *
 * Sending is opt-in per request (`send=1`, carried in the cron path), for the
 * reason written on /api/cron/pl-briefing: a hand-run of a route that decides to
 * send based on the clock delivered a real push to 298 people by accident.
 */

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Desks that must independently be running a story before it is worth a push. */
const MIN_DESKS = 2;
/** Per fanbase, per day. */
const MAX_PER_CLUB_PER_DAY = 2;
/** Older than this and it is not breaking, it is just news. */
const FRESH_MS = 8 * 3_600_000;
/** London hours during which a push may land. */
const WAKING = { from: 8, to: 22 };

function londonHour(): number {
  return Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", hour: "2-digit", hour12: false,
  }).format(new Date()));
}

/**
 * Midnight London today, as a UTC instant — the window the daily cap counts.
 *
 * The cap has to reset on a fan's day, not on UTC's, or in summer it rolls over
 * at 1am. Rather than hardcoding the offset: take today's London date, read it
 * as if it were UTC, then ask what hour that instant actually is in London. In
 * BST the answer is 01:00, so true midnight was an hour earlier; in GMT it is
 * 00:00 and nothing moves. No DST table, no assumption about which way it goes.
 */
function londonDayStart(now: Date): string {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  const asUtc = new Date(`${ymd}T00:00:00Z`);
  const hourThere = Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", hour: "2-digit", hour12: false,
  }).format(asUtc));
  return new Date(asUtc.getTime() - hourThere * 3_600_000).toISOString();
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (process.env.CLUB_NEWS_PUSH_ENABLED === "false") {
    return NextResponse.json({ enabled: false, note: "disabled via CLUB_NEWS_PUSH_ENABLED=false" });
  }

  const scheduled = req.nextUrl.searchParams.get("send") === "1";
  const confirmed = req.nextUrl.searchParams.get("confirm") === "send";
  const dry = req.nextUrl.searchParams.get("dry") === "1" || !(scheduled || confirmed);

  const hour = londonHour();
  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!force && (hour < WAKING.from || hour >= WAKING.to)) {
    return NextResponse.json({ skipped: "quiet hours", londonHour: hour });
  }

  const db = createServiceClient() as unknown as SupabaseClient;
  const now = new Date();

  // The feed doc the app itself shows — same stories, no second fetch.
  const { data } = await db.from("pl_news_feed").select("doc").eq("id", 1).maybeSingle();
  const items = (((data as { doc?: PlNewsFeed } | null)?.doc?.items) ?? []) as PlNewsItem[];
  if (items.length === 0) return NextResponse.json({ ok: true, note: "empty feed" });

  // Clustering drops roundups, columns and live blogs before it counts desks —
  // pushing a fan a rolling live blog whose headline changes hourly would be
  // worse than pushing nothing.
  const ranked = selectStories(items, now.getTime(), 40)
    .filter((s) => s.desks >= MIN_DESKS)
    .filter((s) => now.getTime() - new Date(s.item.publishedAt).getTime() <= FRESH_MS);

  // How many stories each club has already had today, so the cap survives across
  // the 48 runs in a day. Distinct keys, because one key covers many users.
  const dayStart = londonDayStart(now);
  const { data: sentToday } = await db
    .from("notification_log").select("key")
    .like("key", "club-news:%").gte("sent_at", dayStart);
  const usedByClub = new Map<string, Set<string>>();
  for (const row of (sentToday ?? []) as { key: string }[]) {
    const club = row.key.split(":")[1];
    if (!club) continue;
    if (!usedByClub.has(club)) usedByClub.set(club, new Set());
    usedByClub.get(club)!.add(row.key);
  }

  const sent: { club: string; targeted: number; headline: string; desks: number }[] = [];
  const skipped: { club: string; reason: string }[] = [];

  for (const { item, desks } of ranked) {
    for (const club of clubsInHeadline(item.title)) {
      const used = usedByClub.get(club) ?? new Set<string>();
      const key = clubNewsKey(club, item.id);
      if (used.has(key)) continue; // already pushed this exact story
      if (used.size >= MAX_PER_CLUB_PER_DAY) {
        skipped.push({ club, reason: "daily cap" });
        continue;
      }

      // This club's fans, opted in. Two reads rather than a join because
      // club_supporters and profiles are separate tables and PostgREST caps a
      // response at 1000 rows — the largest fanbase is well inside that today,
      // but the opt-in filter is applied again inside notifyUsers regardless.
      const { data: fans } = await db
        .from("club_supporters").select("user_id").eq("club", club);
      const userIds = (fans ?? []).map((f) => f.user_id as string);
      if (userIds.length === 0) continue;

      const { title, body } = clubPushCopy(club, item.title);
      const url = `/matchweek?story=${item.id}`;

      if (dry) {
        // Report the reachable count so a dry run is worth reading. notifyUsers
        // would narrow this again by opt-in; this is the upper bound.
        sent.push({ club, targeted: userIds.length, headline: item.title, desks });
        used.add(key);
        usedByClub.set(club, used);
        continue;
      }

      const { targeted } = await notifyUsers({ userIds, title, body, url, dedupeKey: key });
      // An inbox row per fan who was actually pushed, so the story is still
      // there when they open the app later. Only for those targeted: writing a
      // row for someone who never got the push would put an item in their inbox
      // they have no memory of receiving.
      if (targeted > 0) {
        const { data: reached } = await db
          .from("notification_log").select("user_id").eq("key", key);
        await Promise.all(((reached ?? []) as { user_id: string }[]).map((r) =>
          createNotification({
            userId: r.user_id, type: "club_news", title, body, url, dedupeKey: `${key}:${r.user_id}`,
          }),
        ));
      }

      sent.push({ club, targeted, headline: item.title, desks });
      used.add(key);
      usedByClub.set(club, used);
    }
  }

  return NextResponse.json({
    ok: true,
    londonHour: hour,
    dry,
    candidates: ranked.length,
    minDesks: MIN_DESKS,
    sent,
    skipped,
  });
}
