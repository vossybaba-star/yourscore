import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { fantasyHomePublic } from "@/lib/fantasy/home";

// The PUBLIC fantasy feed for no-account browsers — read-only, no auth. Shows the
// best of the live feed (real squads + portraits) to pull people in. No personal
// data. Kept off the withFantasyUser gate on purpose; the client renders a join
// hook alongside it.
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = createServiceClient();
    return NextResponse.json(await fantasyHomePublic(db));
  } catch (e) {
    console.error("[fantasy:home-public]", e);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
