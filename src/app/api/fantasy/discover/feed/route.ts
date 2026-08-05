import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { loadDiscoverFeed, type DiscoverFilter } from "@/lib/fantasy/feed";

// Social → Discover's feed-backed filter chips (Phase 5b, AC2): Trending,
// Players, Polls, Squads, Games. PUBLIC to view — same "Social is open"
// call as /api/fantasy/leagues/discover and /api/fantasy/discover.
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const FILTERS = new Set<DiscoverFilter>(["trending", "players", "polls", "squads", "games"]);

export async function GET(req: NextRequest) {
  const filter = req.nextUrl.searchParams.get("filter") ?? "";
  if (!FILTERS.has(filter as DiscoverFilter)) return NextResponse.json({ error: "bad filter" }, { status: 400 });

  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  const db = createServiceClient();
  const result = await loadDiscoverFeed(db, user?.id ?? null, filter as DiscoverFilter, 30);
  return NextResponse.json(result);
}
