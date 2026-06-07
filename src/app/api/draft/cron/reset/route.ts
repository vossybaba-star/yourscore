import { NextRequest, NextResponse } from "next/server";
import { createDraftDb } from "@/lib/draft/server";

// Daily leaderboard reset — zero wins_today for rows whose last win predates today
// (UTC). Schedule at 00:00 UTC (Vercel cron / pg_cron) with the CRON_SECRET bearer,
// same pattern as /api/cron/reclassify.

export async function GET(req: NextRequest) {
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createDraftDb();
  const { error } = await db.rpc("draft_reset_daily", {});
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ reset: true });
}
