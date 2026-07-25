import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { tickSeason } from "@/lib/fantasy/season";

/**
 * The heartbeat of the live season: lock at the deadline, ingest the matches,
 * score everyone, close the gameweek. Nobody presses a button; the season runs.
 *
 * Runs every 10 minutes. It must be cheap and idempotent when there's nothing to
 * do (most of the week there isn't), and it must never advance the state machine
 * on data it doesn't trust — see the feed-downtime law in season.ts.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const report = await tickSeason(createServiceClient());
    // "waiting" is the normal state for most of the week — don't log it as work.
    const acted = report.filter((r) => r.action !== "waiting");
    if (acted.length) console.log("[fantasy-tick]", JSON.stringify(acted));
    return NextResponse.json({ ok: true, report });
  } catch (e) {
    // A throw here means the season stopped moving — that is the loudest possible
    // failure in this game, so make sure it shows up as a 500, not a silent ok.
    console.error("[fantasy-tick] FAILED", e);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
