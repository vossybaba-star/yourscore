import type { NextRequest } from "next/server";
import { withSignedInUser } from "@/app/api/fantasy/_lib";
import { submitReport } from "@/lib/social/safety";

/** POST /api/social/report { subjectType: "post"|"comment"|"profile", subjectId, reason? }
 *  (Social Phase 5a, AC2). Any signed-in user — not fantasy-allowlist-gated
 *  (withSignedInUser, not withFantasyUser): reporting is a safety surface,
 *  never a launch-gated feature. Rate-limited + auth handled by the shared
 *  plumbing (401 for a guest — AC8). */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return withSignedInUser("social-report", (db, userId) => submitReport(db, userId, body));
}
