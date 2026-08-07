import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { buildAndStoreScoutLatest } from "@/lib/fantasy/scoutLatest";

/**
 * Daily cron: build and auto-publish Scout's Latest — the rotating 1-3 player
 * ideas the Scout surfaces on the Picks tab (scoutLatest.ts). UNLIKE the Four
 * Picks there is no draft/approve gate: selection is mechanical, copy is
 * grounded, and today's row is upserted straight to published. That is the
 * whole point — the manual approve step is exactly what left the Four Picks
 * frozen for a week.
 *
 * Kill switch: FANTASY_SCOUT_LATEST_ENABLED must be "true" or this no-ops, so
 * the surface can be pulled from Vercel env without a deploy. Auth: Bearer
 * CRON_SECRET, same as every other cron.
 */
export const fetchCache = "force-no-store";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (process.env.FANTASY_SCOUT_LATEST_ENABLED !== "true") {
    return NextResponse.json({ ok: true, skipped: "disabled" });
  }

  // Bucket by London day so a run near a UTC boundary lands on the right date.
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });

  const db = createServiceClient();
  const doc = await buildAndStoreScoutLatest(db, today);
  if (!doc) return NextResponse.json({ ok: true, skipped: "no snapshot" });

  return NextResponse.json({
    ok: true, day: doc.day, gw: doc.gw, count: doc.items.length,
    ideas: doc.items.map((i) => ({ kind: i.kind, player: i.name, copy: i.copySource })),
  });
}
