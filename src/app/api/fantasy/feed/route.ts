/** GET /api/fantasy/feed?scope=following|global — the activity feed for the
 *  league/community surface. Auth + founder gate + rate limit via withFantasyUser;
 *  the service client resolves the follow graph, profiles, and reaction counts. */
import type { NextRequest } from "next/server";
import { withFantasyUser } from "@/app/api/fantasy/_lib";
import { loadFeed, type FeedScope, type FeedSort } from "@/lib/fantasy/feed";

export const fetchCache = "force-no-store";

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const scope: FeedScope = sp.get("scope") === "global" ? "global" : "following";
  const sort: FeedSort = sp.get("sort") === "top" ? "top" : "recent";
  return withFantasyUser("feed", (db, userId) => loadFeed(db, userId, scope, sort));
}
