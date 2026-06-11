import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { createDraftDb, validateAndScore } from "@/lib/draft/server";
import { asLeague } from "@/lib/draft/types";

// Save the player's current XI to the cloud. Server-authoritative: Strength +
// projection are recomputed from the squad (client ratings ignored). One active
// team per user (unique index on user_id), upserted. Saving a new XI also clears
// any "stale" status — the rebuild that the loss penalty requires.

// Load the authenticated user's active team from the cloud. Used by the team page
// on mount to ensure each account sees their own XI, not a stale localStorage team
// left over from a different account on the same browser.
export async function GET() {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ team: null });

  const db = createDraftDb();
  const { data } = await db
    .from("draft_teams")
    .select("formation, squad, strength_rating, projected, competition, status, win_streak")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({ team: data ?? null });
}

export async function POST(req: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to save" }, { status: 401 });

  const { ok } = await rateLimitDistributed(`draft-team:${user.id}`, 30, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: { formation?: unknown; squad?: unknown; competition?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const competition = asLeague(typeof body.competition === "string" ? body.competition : null);

  let validated;
  try {
    validated = validateAndScore(body.formation, body.squad);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid team";
    // A team referencing players that no longer exist was built on an older
    // player database — give a clear "rebuild" message instead of internals.
    const friendly = /^Unknown player/.test(msg)
      ? "Your team is out of date — rebuild it to play."
      : msg;
    return NextResponse.json({ error: friendly, stale: /^Unknown player/.test(msg) }, { status: 400 });
  }

  const db = createDraftDb();
  const { data: profile } = await db
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();

  const { error } = await db
    .from("draft_teams")
    .upsert(
      {
        user_id: user.id,
        display_name: profile?.display_name ?? "Player",
        formation: validated.formation,
        squad: validated.squad as unknown as never,
        strength_rating: validated.strength,
        projected: validated.projected as unknown as never,
        status: "active",
        competition,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,competition" }
    );

  if (error) {
    return NextResponse.json({ error: "Could not save team" }, { status: 500 });
  }

  return NextResponse.json({
    saved: true,
    strength: validated.strength,
    projected: validated.projected,
  });
}
