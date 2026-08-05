import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyUsers } from "@/lib/notify";
import { createNotification } from "@/lib/notifications";
import { entitiesOf, selectStories } from "@/lib/pl/briefing";
import { clubDisplay, clubNewsKey, clubPushCopy, clubsInHeadline, isSameSaga } from "@/lib/pl/clubNews";
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

/**
 * Desks that must independently be running a story before it is worth a push.
 *
 * Raised from 2 to 3 after the first live day. At 2 the league produced 23
 * qualifying stories; at 3 it produces about 10, and a quiet day produces none —
 * which is the point. There is no obligation to send anything.
 */
const MIN_DESKS = 3;
/** Per fanbase, per day. */
const MAX_PER_CLUB_PER_DAY = 2;
/**
 * The fix for the actual incident: ONE story per run.
 *
 * The daily cap was per DAY with nothing spacing it, so a single run walked the
 * ranked list and fired everything that qualified — seven pushes in 22 seconds
 * on 5 Aug, two of them to the same Arsenal fan seventeen seconds apart. The cap
 * was never the constraint that mattered; the burst was.
 *
 * One per run means the 30 minute cron schedule becomes the floor between
 * stories, and the run picks the BEST one rather than the first it trips over.
 */
const MAX_STORIES_PER_RUN = 1;
/** Minimum spacing between two pushes to the same fanbase. */
const CLUB_GAP_MS = 6 * 3_600_000;
/** No user hears from ANY part of the app within this window of a club push. */
const USER_GAP_MINUTES = 4 * 60;
/** A story sharing this many entities with something already pushed to a club is
 *  the same saga wearing a new headline. */
const SAGA_OVERLAP = 2;
/** How far back saga dedupe looks. */
const SAGA_WINDOW_DAYS = 3;
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

  // What each club has already had today, and when. Two jobs: the daily cap,
  // and the spacing — a club that heard from us an hour ago waits.
  const dayStart = londonDayStart(now);
  const { data: sentToday } = await db
    .from("notification_log").select("key, sent_at")
    .like("key", "club-news:%").gte("sent_at", dayStart);
  const usedByClub = new Map<string, Set<string>>();
  const lastByClub = new Map<string, number>();
  for (const row of (sentToday ?? []) as { key: string; sent_at: string }[]) {
    const club = row.key.split(":")[1];
    if (!club) continue;
    if (!usedByClub.has(club)) usedByClub.set(club, new Set());
    usedByClub.get(club)!.add(row.key);
    const t = new Date(row.sent_at).getTime();
    if (t > (lastByClub.get(club) ?? 0)) lastByClub.set(club, t);
  }

  // Headlines already pushed to each club recently, for saga dedupe. The inbox
  // row carries the headline as its body and the club in its title, so no extra
  // storage is needed to answer "have we already covered this saga".
  const sagaSince = new Date(now.getTime() - SAGA_WINDOW_DAYS * 86_400_000).toISOString();
  const { data: covered } = await db
    .from("notifications").select("title, body")
    .eq("type", "club_news").gte("created_at", sagaSince);
  const coveredByClub = new Map<string, Set<string>[]>();
  for (const row of (covered ?? []) as { title: string | null; body: string | null }[]) {
    const club = (row.title ?? "").replace(/ news$/, "");
    if (!club || !row.body) continue;
    if (!coveredByClub.has(club)) coveredByClub.set(club, []);
    coveredByClub.get(club)!.push(entitiesOf(row.body));
  }

  /** Same saga, new headline? */
  function alreadyCovered(clubDisplayName: string, title: string): boolean {
    const ents = entitiesOf(title);
    return (coveredByClub.get(clubDisplayName) ?? [])
      .some((prev) => isSameSaga(ents, prev, SAGA_OVERLAP));
  }

  const sent: { club: string; targeted: number; headline: string; desks: number }[] = [];
  const skipped: { club: string; headline: string; reason: string }[] = [];
  let storiesSent = 0;

  // Ranked best-first, so the one story this run sends is the biggest one
  // available rather than whichever happened to come first in the feed.
  for (const { item, desks } of ranked) {
    if (storiesSent >= MAX_STORIES_PER_RUN) break;
    const clubs = clubsInHeadline(item.title);
    let sentForThisStory = false;

    for (const club of clubs) {
      const used = usedByClub.get(club) ?? new Set<string>();
      const key = clubNewsKey(club, item.id);
      if (used.has(key)) continue;
      if (used.size >= MAX_PER_CLUB_PER_DAY) {
        skipped.push({ club, headline: item.title, reason: "daily cap" });
        continue;
      }
      const since = now.getTime() - (lastByClub.get(club) ?? 0);
      if (since < CLUB_GAP_MS) {
        skipped.push({ club, headline: item.title, reason: `club gap (${Math.round(since / 60000)}m ago)` });
        continue;
      }
      const display = clubDisplay(club);
      if (alreadyCovered(display, item.title)) {
        skipped.push({ club, headline: item.title, reason: "saga already covered" });
        continue;
      }

      const { data: fans } = await db
        .from("club_supporters").select("user_id").eq("club", club);
      const userIds = (fans ?? []).map((f) => f.user_id as string);
      if (userIds.length === 0) continue;

      const { title, body } = clubPushCopy(club, item.title);
      const url = `/matchweek?story=${item.id}`;

      if (dry) {
        sent.push({ club, targeted: userIds.length, headline: item.title, desks });
        sentForThisStory = true;
        continue;
      }

      const { targeted } = await notifyUsers({
        userIds, title, body, url, dedupeKey: key,
        // Nobody hears from us twice in four hours, whatever sent the first one.
        minGapMinutes: USER_GAP_MINUTES,
      });
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
      lastByClub.set(club, now.getTime());
      sentForThisStory = true;
    }

    if (sentForThisStory) storiesSent++;
  }

  return NextResponse.json({
    ok: true,
    londonHour: hour,
    dry,
    candidates: ranked.length,
    minDesks: MIN_DESKS,
    storiesSent,
    // Every story that cleared the desk bar, with the clubs it maps to. Without
    // this a run that sends nothing is indistinguishable from a run that found
    // nothing, and those need different fixes.
    considered: ranked.map(({ item, desks }) => ({
      desks, headline: item.title, clubs: clubsInHeadline(item.title), id: item.id,
    })),
    sent,
    skipped,
  });
}
