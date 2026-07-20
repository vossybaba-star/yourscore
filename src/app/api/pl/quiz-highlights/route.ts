import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import type { QuizHighlightsDoc } from "@/lib/pl/highlights";

/**
 * GET /api/pl/quiz-highlights — PUBLIC. The stat-tile highlights for Live Quiz.
 * Reads the singleton `quiz_highlights` doc (id=1) an aggregation job writes.
 * Soft-fails to empty so the section self-hides rather than erroring.
 */

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET() {
  const db = createServiceClient() as unknown as SupabaseClient;
  try {
    const { data } = await db.from("quiz_highlights").select("doc").eq("id", 1).maybeSingle();
    const doc = ((data as { doc?: QuizHighlightsDoc } | null)?.doc ?? { items: [], updatedAt: null }) as QuizHighlightsDoc;
    return NextResponse.json({ doc }, { headers: cache() });
  } catch (err) {
    console.error("[pl/quiz-highlights] read failed", err);
    return NextResponse.json({ doc: { items: [], updatedAt: null }, error: "unavailable" }, { status: 200, headers: cache() });
  }
}

function cache(): Record<string, string> {
  return { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" };
}
