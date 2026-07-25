import { NextRequest, NextResponse } from "next/server";
import { cancelStaleFixture, getDueRows, publishFixture } from "@/lib/gameday/publish";
import { getScheduledFixtureIds } from "@/lib/gameday/sportmonks";

/**
 * GET /api/cron/gameday-publish — Vercel cron, 08:00 AND 09:00 UTC daily
 * (vercel.json). BOTH hours deliberately: Vercel crons run in UTC and 09:00
 * Europe/London is 08:00 UTC in BST, 09:00 UTC in GMT. This route is
 * idempotent (CAS + on-conflict-do-nothing pack insert), so the tick that
 * lands before a row's publish_at is simply a {idle:true} no-op for it.
 *
 * Logic, in order (§4.1):
 *   1. Nothing due → {idle:true}, zero SportMonks calls, zero writes.
 *   2. A due row whose KICKOFF has already passed → cancelled, never
 *      published (a pack for a match already played is pointless and its
 *      content may now read as stale).
 *   3. Postponement check: one call for tomorrow's tracked fixtures; any no
 *      longer scheduled → cancelled, no pack, no push.
 *   4. Everything else due publishes, one CAS per row (publishFixture is
 *      itself idempotent, so a missed tick's row just publishes on this one —
 *      the catch-up case needs no special handling here).
 *   5. Return counts. The health check asserts against them.
 *
 * Auth: Bearer CRON_SECRET.
 */

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const due = await getDueRows(now);

  // ── 1. Idle. Zero SportMonks calls, zero writes. ──────────────────────────
  if (!due.length) {
    return NextResponse.json({ idle: true });
  }

  const published: number[] = [];
  const cancelledKickedOff: number[] = [];
  const cancelledPostponed: number[] = [];
  const failed: Array<{ fixtureId: number; reason?: string }> = [];

  // Recap packs are exempt from steps 2 and 3, which are fixture-only concepts:
  // a recap publishes AFTER its gameweek finishes, so its (nominal) kickoff is
  // always in the past — the "kickoff already passed" cancel would kill every
  // recap — and a recap has no real SportMonks fixture to be "still scheduled".
  // A recap that is approved and past its publish_at simply publishes (step 4).
  const isFixtureKind = (r: (typeof due)[number]) => r.kind !== "recap";

  // ── 2. Kickoff already passed while still approved → cancelled. ──────────
  const stillDue = [];
  for (const row of due) {
    if (isFixtureKind(row) && new Date(row.kickoff_at).getTime() <= now.getTime()) {
      const res = await cancelStaleFixture(row.fixture_id, "kickoff already passed while approved");
      if (res.cancelled) cancelledKickedOff.push(row.fixture_id);
      continue;
    }
    stillDue.push(row);
  }

  // ── 3. Postponement check — one call, best-effort. ────────────────────────
  // Never blocks a legitimate publish: a SportMonks hiccup here must not stop
  // otherwise-healthy fixtures going live. Fixture rows only (recaps skipped).
  const stillDueFixtures = stillDue.filter(isFixtureKind);
  if (stillDueFixtures.length) {
    try {
      const kickoffDates = Array.from(
        new Set(
          stillDueFixtures.map((r) => new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(new Date(r.kickoff_at))),
        ),
      );
      const scheduledIds = new Set<number>();
      for (const date of kickoffDates) {
        for (const id of Array.from(await getScheduledFixtureIds(date))) scheduledIds.add(id);
      }
      for (const row of [...stillDueFixtures]) {
        if (!scheduledIds.has(row.fixture_id)) {
          const res = await cancelStaleFixture(row.fixture_id, "no longer on SportMonks' schedule");
          if (res.cancelled) {
            cancelledPostponed.push(row.fixture_id);
            const idx = stillDue.indexOf(row);
            if (idx >= 0) stillDue.splice(idx, 1);
          }
        }
      }
    } catch (err) {
      console.error("[gameday-publish] postponement check failed, continuing without it", err);
    }
  }

  // ── 4. Publish everything left. ────────────────────────────────────────────
  for (const row of stillDue) {
    const out = await publishFixture(row.fixture_id);
    if (out.published) published.push(row.fixture_id);
    else if (!out.already) failed.push({ fixtureId: row.fixture_id, reason: out.reason });
  }

  return NextResponse.json({
    idle: false,
    checked: due.length,
    published,
    cancelledKickedOff,
    cancelledPostponed,
    failed,
  });
}
