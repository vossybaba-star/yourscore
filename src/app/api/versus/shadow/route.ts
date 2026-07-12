import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { shadowRunsOf } from "@/lib/versus/shadow";
// Vercel data cache pins service-role GETs (constant cache key) — see CLAUDE.md §4.
export const fetchCache = "force-no-store";

// The revenge library: a player's shadowable runs (latest full multiplayer run
// per pack) + their public profile line. Signed-in only — this powers the
// "play their shadows back" loop, not a public scraping surface.
export async function GET(req: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  try {
    const db = createServiceClient();
    const [{ data: profile }, runs] = await Promise.all([
      db.from("profiles").select("id, display_name, avatar_url, total_score").eq("id", userId).maybeSingle(),
      shadowRunsOf(db, userId),
    ]);
    if (!profile) return NextResponse.json({ error: "Player not found" }, { status: 404 });
    return NextResponse.json({
      player: { id: profile.id, name: profile.display_name ?? "Player", avatarUrl: profile.avatar_url, totalScore: profile.total_score ?? 0 },
      runs,
    });
  } catch {
    return NextResponse.json({ error: "Could not load their runs" }, { status: 500 });
  }
}
