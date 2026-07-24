import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
// Vercel data cache pins service-role GETs (constant cache key) — see CLAUDE.md §4.
export const fetchCache = "force-no-store";

/**
 * Lightweight pre-check for the custom quiz builder: how many verified
 * (active, data-grounded) questions exist for an entity (optionally within an
 * era). The builder calls this when a team/topic is picked so it can tell the
 * user up front whether a quiz can be built — rather than letting them hit
 * "Generate" and only then learn there aren't enough questions.
 *
 * Mirrors the filters in /api/quiz/generate-custom. Era and category are included because the
 * generator narrows by both; difficulty is intentionally ignored here since the generator
 * treats the difficulty mix as a target and tops up across tiers when one is thin.
 */
const ENTITY_RE = /^[A-Za-z0-9 _'.&-]{1,60}$/;
const ALLOWED_ERAS = ["all-time", "early-pl", "2010s", "2020s", "2024-25"];
/** The four locked club topics — must match questions.category and the builder's TOPIC_OPTIONS. */
const ALLOWED_CATEGORIES = ["history-honours", "legends", "modern-era", "rivalries-derbies"];

export async function GET(req: NextRequest) {
  const entity = req.nextUrl.searchParams.get("entity") ?? "";
  const era = req.nextUrl.searchParams.get("era") ?? undefined;
  const category = req.nextUrl.searchParams.get("category") ?? undefined;

  if (!entity || !ENTITY_RE.test(entity)) {
    return NextResponse.json({ error: "Invalid entity" }, { status: 400 });
  }
  if (era !== undefined && era !== "" && !ALLOWED_ERAS.includes(era)) {
    return NextResponse.json({ error: "Invalid era" }, { status: 400 });
  }
  if (category !== undefined && category !== "" && !ALLOWED_CATEGORIES.includes(category)) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }

  const supabase = createServiceClient();
  let query = supabase
    .from("questions")
    .select("id", { count: "exact", head: true })
    .eq("entity", entity)
    .eq("status", "active")
    .eq("source", "data-grounded");

  if (era && era !== "all-time") {
    query = query.eq("era", era);
  }
  // Must mirror the generator: without this the builder would show a club's TOTAL question
  // count while generating from a single topic, and happily let you press Generate on a
  // topic that has nothing in it.
  if (category) {
    query = query.eq("category", category);
  }

  const { count, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ count: count ?? 0 });
}
