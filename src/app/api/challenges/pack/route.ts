import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { slugify } from "@/lib/utils";

// Edge-cached loader for a single published challenge pack.
//
// Why this exists: the challenge page is client-rendered and previously fetched
// pack data straight from the browser to the (eu-central-1) database — a large
// transatlantic round-trip that tanked Speed Insights for users far from the UK.
// Published pack content is effectively static, so we serve it from a route that
// (a) runs next to the DB and (b) is cached at Vercel's CDN edge via s-maxage, so
// repeat loads anywhere in the world are served from the nearest region with no
// database hop. Pack questions are already public (published content), so caching
// them introduces no new exposure; leaderboard/attempt data stays uncached + client-side.

// Typed as `string` (not a string literal) on purpose: `description` exists in the
// live DB but is missing from the stale generated types, and a literal select arg
// would be validated against those types. (TODO: regenerate src/types/database.ts.)
const PACK_COLS: string = "id, name, type, parameter, question_count, description, questions, metadata";

// Cache the rendered response at the CDN edge for an hour, serving stale for a day
// while it revalidates in the background.
const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
};

// The CDN header above is the ONLY intended cache. Without this, Vercel's
// durable Data Cache pins the service-client GET forever — pack edits
// (cover art, questions) would never reach the app between deploys.
export const fetchCache = "force-no-store";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const pid = searchParams.get("pid");
  const slug = searchParams.get("slug");
  if (!pid && !slug) {
    return NextResponse.json({ error: "slug or pid required" }, { status: 400 });
  }

  const sb = createServiceClient();

  let pack: Record<string, unknown> | null = null;

  if (pid) {
    const { data } = await sb
      .from("quiz_packs")
      .select(PACK_COLS)
      .eq("id", pid)
      .eq("status", "published")
      .single();
    pack = data as unknown as Record<string, unknown> | null;
  } else {
    // Resolve slug → id against a lightweight list, then fetch the matched pack.
    const { data: list } = await sb
      .from("quiz_packs")
      .select("id, name")
      .eq("status", "published");
    const found = ((list ?? []) as { id: string; name: string }[]).find(
      (p) => slugify(p.name) === slug,
    );
    if (found) {
      const { data } = await sb
        .from("quiz_packs")
        .select(PACK_COLS)
        .eq("id", found.id)
        .single();
      pack = data as unknown as Record<string, unknown> | null;
    }
  }

  if (!pack) {
    // Don't cache misses for as long — a pack may get published shortly after.
    return NextResponse.json(
      { error: "not found" },
      { status: 404, headers: { "Cache-Control": "public, s-maxage=30" } },
    );
  }

  return NextResponse.json({ pack }, { headers: CACHE_HEADERS });
}
