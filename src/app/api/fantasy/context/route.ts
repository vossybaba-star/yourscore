import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { fantasyContext } from "@/lib/fantasy/context";

// Same reasoning as the pool route: must run per-request, and Next's data cache
// has to be switched off inside it or the service-role read gets pinned forever.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * Fixtures and doubts for the pick surfaces. Shared, per-gameweek, nothing
 * per-user — so it caches at the edge. Five minutes rather than the pool's hour:
 * prices are frozen for a week, but a team-news doubt appearing an hour late is
 * the difference between a good transfer and a wasted one.
 *
 * Public on purpose. The builder is reachable signed out (you can look before you
 * sign up), and it would be strange to show a squad you can't yet judge.
 */
export async function GET() {
  const ctx = await fantasyContext(createServiceClient());
  return NextResponse.json(ctx, {
    headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" },
  });
}
