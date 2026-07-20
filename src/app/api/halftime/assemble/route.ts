import { NextRequest, NextResponse } from "next/server";
import { stageFixture } from "@/lib/halftime/release";

/**
 * POST /api/halftime/assemble — freeze a fixture's final 10 and stage it.
 *
 * Called by the poller at the veto deadline (T-10). Takes the surviving fresh
 * questions (0-3, approved only), fills to exactly 10 from the base slate,
 * applies the deterministic answer shuffle, and writes the result to
 * halftime_releases.pack_questions — the frozen snapshot the whistle later
 * copies verbatim into quiz_packs.
 *
 * NO quiz_packs row is created here. That is the whole point: before the
 * whistle the pack does not exist, so it cannot be opened, played or graded
 * (/api/challenges/pack 404s, solo-complete requires status='published').
 *
 * Body: { fixtureId: number, baseOnly?: boolean }
 * Auth: Bearer CRON_SECRET.
 */

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { fixtureId?: unknown; baseOnly?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const fixtureId = Number(body.fixtureId);
  if (!Number.isInteger(fixtureId) || fixtureId <= 0) {
    return NextResponse.json({ error: "fixtureId (positive integer) required" }, { status: 400 });
  }

  const result = await stageFixture(fixtureId, { baseOnly: body.baseOnly === true });

  if (!result.staged && result.state === "unknown") {
    return NextResponse.json({ error: "Fixture not found", ...result }, { status: 404 });
  }

  return NextResponse.json(result);
}
