import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { captureDeadlineSquads, freezeShadow, scoreShadow } from "@/lib/fantasy/captainShadow";

/**
 * Captain Assist shadow mode. Runs silently: it never shows a user anything and
 * never changes a squad.
 *
 * Both phases run on every tick and each is a cheap no-op when there is nothing
 * to do, which is most of the week:
 *   freeze — before the deadline, freeze a recommendation per user and record
 *            what they had captained at that moment
 *   score  — only once FPL reports the gameweek finished AND data_checked, so no
 *            evaluation ever uses provisional results
 *
 * Idempotent by construction (unique user+gameweek on freeze, scored_at guard on
 * score), so a duplicated schedule tick cannot double-count.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const db = createServiceClient();
    // Order matters: freeze only ever runs pre-deadline, deadline capture only
    // ever runs post-deadline, so on any given tick at most one of them acts.
    const freeze = await freezeShadow(db);
    const deadline = await captureDeadlineSquads(db);
    const score = await scoreShadow(db);
    if (freeze.written || deadline.captured || score.scored || freeze.errors) {
      console.log("[fantasy-shadow]", JSON.stringify({ freeze, deadline, score }));
    }
    return NextResponse.json({ ok: true, freeze, deadline, score });
  } catch (e) {
    // Losing shadow data is losing the only live evidence we will have before
    // deciding whether this feature helps anyone — fail loudly.
    console.error("[fantasy-shadow] FAILED", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
