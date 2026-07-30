/** GET /api/fantasy/feed?scope=following|global — the activity feed for the
 *  league/community surface. Auth + founder gate + rate limit via withFantasyUser;
 *  the service client resolves the follow graph, profiles, and reaction counts. */
import type { NextRequest } from "next/server";
import { withFantasyUser } from "@/app/api/fantasy/_lib";
import { loadFeed, type FeedScope } from "@/lib/fantasy/feed";

export const fetchCache = "force-no-store";

export async function GET(req: NextRequest) {
  const raw = new URL(req.url).searchParams.get("scope");
  const scope: FeedScope = raw === "global" ? "global" : "following";
  return withFantasyUser("feed", (db, userId) => loadFeed(db, userId, scope).then((events) => ({ events })));
}
