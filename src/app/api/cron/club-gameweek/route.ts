import { NextRequest, NextResponse } from "next/server";
import { notifyUsers } from "@/lib/notify";
import {
  clubGameweekBeats,
  clubsForRound,
  halftimeAttemptsForGameweek,
  supportersForSeason,
} from "@/lib/clubs/query";
import { gameweekRecipients, resultCopy, resultDedupeKey, type SendType } from "@/lib/clubs/result";

/**
 * GET /api/cron/club-gameweek — the club-gameweek PUSH sends (email is a separate
 * batched job, scripts/clubs/send-gameweek-email.mjs).
 *
 * TWO beats (founder timing, 2026-07-15), both landing at a high-attention moment
 * rather than the instant the last match ends:
 *   'results'  — the morning after the gameweek's final fixture.
 *   'newweek'  — day one of the following gameweek.
 * EVERYONE with a declared club gets both; players see their personal rank, non-
 * players see just the club result + a nudge (that nudge is the point — it pulls
 * them in next week).
 *
 * Runs hourly, idle on the vast majority of hours. Exactly-once — across re-runs
 * AND across the email job — is notification_log's PK (user_id, key), never this
 * code: each send carries a distinct dedupeKey, so a repeat is a no-op row-conflict,
 * not a second buzz. That is what lets this be a dumb hourly poll.
 *
 * The message is personalised (each fan is told a different position), so this fans
 * out per-fan. Bounded by MAX_PUSHES so a bad query can never become a storm.
 */

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LOOKBACK_HOURS = 72;
const MAX_PUSHES = 4000;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const beats = await clubGameweekBeats({ lookbackHours: LOOKBACK_HOURS });
    if (beats.length === 0) return NextResponse.json({ idle: true, notified: 0 });

    const report: Record<string, number> = {};
    let sent = 0;

    for (const beat of beats) {
      const sends: SendType[] = [];
      if (beat.resultsDue) sends.push("results");
      if (beat.newweekDue) sends.push("newweek");
      if (sends.length === 0) continue;

      const [clubs, supporters, attempts] = await Promise.all([
        clubsForRound(beat.seasonId, beat.roundName),
        supportersForSeason(beat.seasonId),
        halftimeAttemptsForGameweek(beat.seasonId, beat.roundName),
      ]);

      const { recipients } = gameweekRecipients(supporters, attempts, clubs);

      for (const send of sends) {
        const key = resultDedupeKey(send, "push", beat.seasonId, beat.roundName);
        for (const r of recipients) {
          if (sent >= MAX_PUSHES) break;
          const copy = resultCopy(send, r);
          // One send per fan (each is told THEIR position). notification_log's PK
          // makes the repeat a no-op, so an overlapping run costs a row-conflict,
          // never a second buzz.
          const { targeted } = await notifyUsers({
            userIds: [r.userId],
            title: copy.title,
            body: copy.body,
            url: "/play",
            dedupeKey: key,
            requireOptIn: true,
          });
          sent += targeted;
        }
        report[`${beat.roundName}:${send}`] = recipients.length;
      }
    }

    return NextResponse.json({ idle: false, beats: report, notified: sent });
  } catch (err) {
    // Loud, not silent: a failed club send is a real incident, not "no news".
    console.error("[cron/club-gameweek] failed", err);
    return NextResponse.json({ error: "club gameweek push failed" }, { status: 500 });
  }
}
