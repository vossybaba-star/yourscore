import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyUsers } from "@/lib/notify";
import { buildNewsDoc } from "@/lib/fantasy/news";
import { ingestFantasyRss } from "@/lib/fantasy/rssRiver";

/**
 * Hourly cron: rebuild the fantasy news feed (docs/fantasy-news-hub-spec.md).
 *
 * ONE cron with internal per-section staleness gating (the wc-mastermind
 * pattern) — sectionsToRebuild() in news.ts decides what's stale: fixtures
 * daily, team news hourly inside 48h of the deadline (else daily), form after
 * a GW scores, transfers hourly. Everything else is a no-op, so most hourly
 * runs cost zero SportMonks calls.
 *
 * The deadline push nudge fires from HERE too (this cron already knows the
 * deadline) — no separate cron entry. Gated behind FANTASY_NEWS_PUSH_ENABLED;
 * dedupe key `fantasy-deadline:<gw>` makes it once-per-GW no matter how many
 * hourly runs land in the window. Auth: Bearer CRON_SECRET.
 */
export const fetchCache = "force-no-store";
export const maxDuration = 60;

const NUDGE_WINDOW_MS = 24 * 3_600_000;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // ?force=1 rebuilds every section regardless of staleness. Needed whenever a
  // section's SHAPE or logic changes: the staleness gate only asks "is this
  // old?", not "was this built by the current code", so a fresh-but-wrong
  // section would otherwise persist until its window expired.
  const force = req.nextUrl.searchParams.get("force") === "1";

  const db = createServiceClient();

  // Pull the fantasy desks into the editorial river BEFORE the doc is built —
  // buildNewsDoc reads fantasy_news_items for the "Transfers & talk" section, so
  // running it after would leave today's articles waiting an hour for the next
  // cron. Never fatal: a desk being down must not cost us the whole rebuild.
  let river: Awaited<ReturnType<typeof ingestFantasyRss>> | { error: string };
  try {
    river = await ingestFantasyRss(db);
  } catch (err) {
    river = { error: err instanceof Error ? err.message : String(err) };
  }

  const doc = await buildNewsDoc(db, new Date(), { force });
  if (!doc) return NextResponse.json({ ok: true, skipped: "no open gameweek", river });

  let nudged = 0;
  if (process.env.FANTASY_NEWS_PUSH_ENABLED === "true" && doc.deadline) {
    const untilDeadline = new Date(doc.deadline).getTime() - Date.now();
    if (untilDeadline > 0 && untilDeadline < NUDGE_WINDOW_MS) {
      // Everyone with a fantasy squad; notifyUsers enforces opt-in + dedupe.
      const { data: squads } = await db.from("fantasy_squads").select("user_id");
      if (squads?.length) {
        const { targeted } = await notifyUsers({
          userIds: squads.map((s) => s.user_id),
          title: "Deadline today",
          body: "Set your captain and check the team news before the gameweek locks.",
          url: "/fantasy/news",
          dedupeKey: `fantasy-deadline:${doc.gw}`,
        });
        nudged = targeted;
      }
    }
  }

  return NextResponse.json({
    ok: true, gw: doc.gw,
    river,
    sections: {
      fixtures: doc.fixtures.runs.length,
      predicted: doc.teamNews.predicted.length,
      doubts: doc.teamNews.doubts.length,
      form: doc.form.rows.length,
      transfers: doc.transfers.items.length,
      // Present only when the last tips redraft attempt failed (dead key,
      // non-ok response, exception, or failed grounding) — see tips.ts. Also
      // console.error'd from generateTips itself so it isn't silent either way.
      tipsIssue: doc.tips.issue ?? null,
    },
    nudged,
  });
}
