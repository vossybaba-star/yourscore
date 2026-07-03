import { NextResponse } from "next/server";
import { getVersusActivity } from "@/lib/versus/activity";

// Community-activity numbers for the Versus tab ("Live now" strip). Shared by
// every viewer, so serve it edge-cached — one DB sweep per ~30s, not per view.
const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120",
};

export async function GET() {
  try {
    const activity = await getVersusActivity();
    return NextResponse.json(activity, { headers: CACHE_HEADERS });
  } catch {
    return NextResponse.json({ lookingForMatch: 0, battlesToday: 0, activeToday: 0, openLobbies: 0, trending: null, mostActive: null });
  }
}
