import { NextRequest, NextResponse } from "next/server";
import { releaseFixture } from "@/lib/halftime/release";

/**
 * POST /api/halftime/release — put a staged halftime pack live.
 *
 * Called by the VPS poller the instant SportMonks flips the fixture to
 * state_id 3 (HT), and by the watchdog cron as a backstop. Both can fire at
 * once; releaseFixture()'s compare-and-set means exactly one of them inserts
 * the pack and exactly one push goes out. Re-invoking this route for an
 * already-released fixture is a no-op that returns `already: true`.
 *
 * Body: { fixtureId: number, late?: boolean }
 *   late = the second half has already started (the poller died and the
 *   watchdog caught it). The pack still goes live; NO push fires.
 *
 * Auth: Bearer CRON_SECRET.
 */

// Without this, Vercel's durable Data Cache pins the service-role reads and the
// route would release against a stale view of halftime_releases forever.
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { fixtureId?: unknown; late?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const fixtureId = Number(body.fixtureId);
  if (!Number.isInteger(fixtureId) || fixtureId <= 0) {
    return NextResponse.json({ error: "fixtureId (positive integer) required" }, { status: 400 });
  }

  const outcome = await releaseFixture(fixtureId, { late: body.late === true });

  if (outcome.state === "unknown") {
    return NextResponse.json({ error: "Fixture not found", ...outcome }, { status: 404 });
  }

  return NextResponse.json(outcome);
}
