import { NextRequest, NextResponse } from "next/server";
import {
  clubGameweekBeats,
  clubsForRound,
  halftimeAttemptsForGameweek,
  supportersForSeason,
} from "@/lib/clubs/query";
import { emailContent, gameweekRecipients, resultDedupeKey, type SendType } from "@/lib/clubs/result";

/**
 * GET /api/clubs/gameweek-sends — internal feed for the batched EMAIL job
 * (scripts/clubs/send-gameweek-email.mjs, run on the VPS). Bearer CRON_SECRET.
 *
 * Returns, for every due send, the per-recipient copy already rendered — but NO
 * email addresses. The tally lives here (single source of truth, same code the
 * push cron uses); the script resolves user_id → email, filters suppressions,
 * dedups against notification_log, and sends. Keeping the two channels on one
 * copy engine is the whole point of this seam.
 */

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const LOOKBACK_HOURS = 72;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://yourscore.app";

  try {
    const beats = await clubGameweekBeats({ lookbackHours: LOOKBACK_HOURS });
    const out: Array<{
      send: SendType;
      seasonId: number;
      roundName: string;
      dedupeKey: string;
      recipients: Array<
        { userId: string; refId: string; ctaUrl: string } & ReturnType<typeof emailContent>
      >;
    }> = [];

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
        const dedupeKey = resultDedupeKey(send, "email", beat.seasonId, beat.roundName);
        out.push({
          send,
          seasonId: beat.seasonId,
          roundName: beat.roundName,
          dedupeKey,
          recipients: recipients.map((r) => ({
            userId: r.userId,
            refId: `${dedupeKey}:${r.userId}`,
            ...emailContent(send, r, beat.roundName),
            // CTA differs by send; emailContent gives the label, we resolve the URL here.
            ctaUrl: `${base}/play`,
          })),
        });
      }
    }

    return NextResponse.json({ sends: out });
  } catch (err) {
    console.error("[clubs/gameweek-sends] failed", err);
    return NextResponse.json({ error: "failed to build gameweek sends" }, { status: 500 });
  }
}
