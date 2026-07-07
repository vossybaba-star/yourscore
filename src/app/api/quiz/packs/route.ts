import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

// Published + in-rotation quiz packs. This list is identical for every visitor,
// but the /play (Quiz tab) page was fetching it directly from Supabase
// (eu-central-1) on the client after hydration — a ~1s network round-trip even
// though the DB query itself is <1ms. Serve it from a Vercel edge-cached route
// (fra1, adjacent to the DB) so repeat visitors get it from the edge in ~30-50ms.
const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600",
};

// The CDN header above is the ONLY cache this route should have. Without this,
// Vercel's durable Data Cache pins the service-client GET forever (constant
// cache key) — pack metadata edits (e.g. cover art) never reach the app.
export const fetchCache = "force-no-store";

export async function GET() {
  try {
    const db = createServiceClient();
    const { data, error } = await db
      .from("quiz_packs")
      .select("id, name, type, parameter, question_count, status, description, featured, featured_order, metadata, created_at")
      .eq("status", "published")
      .eq("rotation_active", true)
      .order("name");
    if (error) return NextResponse.json({ packs: [] });
    return NextResponse.json({ packs: data ?? [] }, { headers: CACHE_HEADERS });
  } catch {
    return NextResponse.json({ packs: [] });
  }
}
