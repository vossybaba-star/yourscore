import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { loadPublishedScoutPicks, type Db } from "@/lib/fantasy/scoutPicks";

/**
 * Published-only read of Scout's Four Picks, for client-side bits that can't
 * use a server component (e.g. a client island re-fetching after navigation).
 * FourPicks.tsx (the Briefing's server card strip) reads the same data
 * directly via a service client rather than fetching itself — this route
 * exists for everything else.
 *
 * revalidate 300 (not fetchCache="force-no-store"): unlike an authed/service-
 * role route reading PER-USER data, this is the SAME published data for every
 * caller, so it is deliberately cacheable — same reasoning newsUi.tsx's
 * loadFeedDoc() already uses for the general Scout Report. The Vercel-cache
 * gotcha in CLAUDE.md (service-role GETs pin forever with a constant cache
 * key) is dodged the same way loadFeedDoc dodges it: an explicit per-fetch
 * `next: { revalidate }` on the client's own fetch, not the route's default.
 */
export const revalidate = 300;

function serviceClient(): Db {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false },
      global: {
        fetch: (url: RequestInfo | URL, init?: RequestInit) =>
          fetch(url, { ...init, next: { revalidate: 300 } }),
      },
    },
  );
}

export async function GET(req: NextRequest) {
  const gwParam = req.nextUrl.searchParams.get("gw");
  const gw = gwParam ? Number(gwParam) : undefined;
  if (gwParam && (!Number.isFinite(gw) || gw! <= 0)) {
    return NextResponse.json({ error: "invalid gw" }, { status: 400 });
  }
  const db = serviceClient();
  const picks = await loadPublishedScoutPicks(db, gw);
  return NextResponse.json({ picks });
}
