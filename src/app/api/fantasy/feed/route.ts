/** GET /api/fantasy/feed?scope=following|global — the public activity feed.
 *
 * Anyone can VIEW it, signed in or not (founder, 3 Aug — Fantasy PL isn't gated;
 * you just can't CONTRIBUTE without an account). A signed-in user gets their
 * "following" scope and their own reactions/votes marked; a guest only ever sees
 * the global feed. Contributing (post, react, comment, vote, follow) stays gated
 * on its own routes. The service client resolves the graph, profiles and tallies. */
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { loadFeed, type FeedScope, type FeedSort } from "@/lib/fantasy/feed";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  let scope: FeedScope = sp.get("scope") === "global" ? "global" : "following";
  const sort: FeedSort = sp.get("sort") === "top" ? "top" : "recent";

  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) scope = "global"; // "following" needs an account

  const db = createServiceClient();
  const result = await loadFeed(db, user?.id ?? null, scope, sort);
  return NextResponse.json(result);
}
