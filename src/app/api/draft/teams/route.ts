import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { createDraftDb, validateAndScore } from "@/lib/draft/server";

// Saved-teams library (separate from the single active draft_teams row).
//   GET    → list the signed-in user's saved teams (newest first)
//   POST   → save the current XI to the library (server-validated + scored)
//   DELETE → remove one of the user's saved teams (?id= or body {id})
// Fails soft (empty list / clear error) before the migration is applied.

const MAX_SAVED = 24;

export async function GET() {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ teams: [] });

  try {
    const db = createDraftDb();
    const { data, error } = await db
      .from("draft_saved_teams")
      .select("id, name, formation, squad, strength_rating, projected, updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });
    if (error) return NextResponse.json({ teams: [], ready: false });
    return NextResponse.json({ teams: data ?? [], ready: true });
  } catch {
    return NextResponse.json({ teams: [], ready: false });
  }
}

export async function POST(req: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to save teams" }, { status: 401 });

  const { ok } = await rateLimitDistributed(`draft-saveteam:${user.id}`, 30, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: { name?: unknown; formation?: unknown; squad?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const name = (typeof body.name === "string" ? body.name : "").trim().slice(0, 40) || "My XI";

  let validated;
  try {
    validated = validateAndScore(body.formation, body.squad);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid team";
    const friendly = /^Unknown player/.test(msg) ? "This team is out of date — rebuild it to save." : msg;
    return NextResponse.json({ error: friendly }, { status: 400 });
  }

  const db = createDraftDb();

  // Enforce a per-user cap so the library stays tidy.
  const { count } = await db
    .from("draft_saved_teams")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  if ((count ?? 0) >= MAX_SAVED) {
    return NextResponse.json({ error: `You can save up to ${MAX_SAVED} teams — delete one first.` }, { status: 400 });
  }

  const { data, error } = await db
    .from("draft_saved_teams")
    .insert({
      user_id: user.id,
      name,
      formation: validated.formation,
      squad: validated.squad as unknown as never,
      strength_rating: validated.strength,
      projected: validated.projected as unknown as never,
      updated_at: new Date().toISOString(),
    })
    .select("id, name, formation, squad, strength_rating, projected, updated_at")
    .single();

  if (error || !data) return NextResponse.json({ error: "Could not save team" }, { status: 500 });
  return NextResponse.json({ team: data });
}

export async function DELETE(req: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in" }, { status: 401 });

  let id = req.nextUrl.searchParams.get("id");
  if (!id) { try { id = (await req.json())?.id ?? null; } catch { /* none */ } }
  if (!id) return NextResponse.json({ error: "Missing team id" }, { status: 400 });

  const db = createDraftDb();
  const { error } = await db.from("draft_saved_teams").delete().eq("id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: "Could not delete" }, { status: 500 });
  return NextResponse.json({ deleted: true });
}
