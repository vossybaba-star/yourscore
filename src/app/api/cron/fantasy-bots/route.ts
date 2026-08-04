import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { runBotTick } from "@/lib/fantasy/bots";

/**
 * Hourly bot tick — the persona accounts (profiles.source = 'bot') drop FPL-
 * Twitter-style posts, reactions and poll votes into the fantasy feed so it
 * reads like a live timeline while the real user base grows. See
 * src/lib/fantasy/bots.ts for the behaviour and volume rules; no bot accounts
 * configured → the tick is a no-op.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  // Fail closed if CRON_SECRET is unset — same posture as fantasy-tick.
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const report = await runBotTick(createServiceClient());
    if (report.posted || report.reactions || report.pollVotes) console.log("[fantasy-bots]", JSON.stringify(report));
    return NextResponse.json({ ok: true, report });
  } catch (e) {
    console.error("[fantasy-bots] FAILED", e);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
