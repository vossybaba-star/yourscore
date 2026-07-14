import { NextRequest, NextResponse } from "next/server";
import { notifyUsers } from "@/lib/notify";
import {
  clubsForSeason,
  completedGameweeks,
  halftimeAttemptsForGameweek,
  supportersForSeason,
} from "@/lib/clubs/query";
import { gameweekResults, resultCopy, resultDedupeKey } from "@/lib/clubs/result";

/**
 * GET /api/cron/club-gameweek — the end-of-gameweek club result push.
 *
 * "Arsenal finished 3rd this gameweek. You were their 12th-best scorer."
 *
 * Runs hourly. Does nothing at all on the ~95% of hours where no gameweek has
 * just finished (zero pushes, one cheap read) — the same no-op-when-idle
 * discipline as the halftime watchdog.
 *
 * WHEN IS A GAMEWEEK "OVER"? halftime_releases' state machine stops at the
 * HALFTIME whistle — there is no full-time state to wait on. So a round is
 * treated as finished once its LAST kickoff is more than SETTLE_MINUTES old.
 * 135 minutes covers a match (~115 with the interval) plus a generous cushion
 * for stoppages, so we are never announcing a table while a fixture is still
 * being played into.
 *
 * EXACTLY-ONCE, and it is the DB that guarantees it, not this code: every push
 * carries dedupeKey `club-gw:<season>:<round>`, and notification_log's PRIMARY
 * KEY (user_id, key) means a re-run — or two crons overlapping — physically
 * cannot send a fan the same gameweek result twice. Re-running this route is
 * therefore free and idempotent by construction, which is what lets it be a
 * dumb hourly poll instead of a fragile "did I already do this?" ledger.
 *
 * The personalisation forces one send per user (each fan is told a different
 * position), so this fans out per-fan rather than per-club. That is fine at our
 * scale and bounded by MAX_PUSHES below.
 */

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** A round is settled once its last kickoff is this old. */
const SETTLE_MINUTES = 135;
/** Don't look further back than this — an old, already-notified round is not worth re-walking. */
const LOOKBACK_HOURS = 72;
/** Hard bound on a single run, so a bad query can never become a push storm. */
const MAX_PUSHES = 2000;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const rounds = await completedGameweeks({
      settleMinutes: SETTLE_MINUTES,
      lookbackHours: LOOKBACK_HOURS,
    });

    if (rounds.length === 0) {
      // The common case, by a mile. Cost: one read, zero pushes.
      return NextResponse.json({ idle: true, notified: 0 });
    }

    const report: Record<string, number> = {};
    let sent = 0;

    for (const { seasonId, roundName } of rounds) {
      const [clubs, supporters, attempts] = await Promise.all([
        clubsForSeason(seasonId),
        supportersForSeason(seasonId),
        halftimeAttemptsForGameweek(seasonId, roundName),
      ]);

      const { results } = gameweekResults(supporters, attempts, clubs);
      const key = resultDedupeKey(seasonId, roundName);

      for (const r of results) {
        if (sent >= MAX_PUSHES) break;
        const copy = resultCopy(r);
        // One send per fan: the whole point is that each is told THEIR position.
        // notification_log's PK makes the repeat a no-op, so an overlapping run
        // costs a row-conflict, never a second buzz in someone's pocket.
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

      report[`${seasonId}:${roundName}`] = results.length;
    }

    return NextResponse.json({ idle: false, rounds: report, notified: sent });
  } catch (err) {
    // Loud, not silent: a failed result push is a real incident, not "no news".
    console.error("[cron/club-gameweek] failed", err);
    return NextResponse.json({ error: "club gameweek push failed" }, { status: 500 });
  }
}
