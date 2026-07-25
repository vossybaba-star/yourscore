import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { runOps } from "@/lib/fantasy/ops";

/**
 * The watchdog: read-only + Telegram alerts + one narrow veto (ops_hold on a
 * scored gameweek). It never advances the live season — that's fantasy-tick's
 * job. It checks that the calendar and the facts still agree with the
 * upstream feeds, and shouts (and, for a scored gameweek gone wrong, blocks
 * finalise) when they don't. Runs hourly.
 *
 * Kill switch: FANTASY_OPS_ENABLED must be the literal string "true" or this
 * is a zero-fetch, zero-write no-op — same posture as fantasy-tick would want
 * if it needed one, but this one actually does because it's new and alert-first.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (process.env.FANTASY_OPS_ENABLED !== "true") {
    return NextResponse.json({ ok: true, report: [{ action: "noop", detail: "disabled" }] });
  }
  try {
    const report = await runOps(createServiceClient());
    const acted = report.filter((r) => r.action !== "green");
    if (acted.length) console.log("[fantasy-ops]", JSON.stringify(acted));
    return NextResponse.json({ ok: true, report });
  } catch (e) {
    console.error("[fantasy-ops] FAILED", e);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
