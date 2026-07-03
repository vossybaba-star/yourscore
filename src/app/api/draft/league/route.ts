import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { createDraftDb, genJoinCode } from "@/lib/draft/server";
import { sendFirst38LeagueEmail } from "@/lib/email/senders";

// POST: create a private league (generates a join code, adds owner as a member).
// GET:  list the leagues the signed-in user belongs to, with member counts.

export async function POST(req: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to create a league" }, { status: 401 });

  const { ok } = await rateLimitDistributed(`draft-league:${user.id}`, 10, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: { name?: unknown; isPublic?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 40) : "";
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
  const isPublic = body.isPublic === true; // default private (migration 64)

  const db = createDraftDb();

  // Insert with a fresh code, retrying on the (rare) unique-collision.
  let created: { id: string; name: string; join_code: string } | null = null;
  for (let attempt = 0; attempt < 5 && !created; attempt++) {
    const { data, error } = await db
      .from("draft_leagues")
      .insert({ owner_id: user.id, name, join_code: genJoinCode(), is_public: isPublic })
      .select("id, name, join_code")
      .single();
    if (!error && data) created = data;
    else if (error && error.code !== "23505") {
      return NextResponse.json({ error: "Could not create league" }, { status: 500 });
    }
  }
  if (!created) return NextResponse.json({ error: "Could not create league" }, { status: 500 });

  await db.from("draft_league_members").upsert(
    { league_id: created.id, user_id: user.id },
    { onConflict: "league_id,user_id" }
  );

  // Lifecycle: if this was the user's first-ever 38-0 league, fire email 14.
  if (user.email) {
    void (async () => {
      const { count } = await db
        .from("draft_leagues")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", user.id);
      if ((count ?? 0) !== 1) return;
      await sendFirst38LeagueEmail({
        userId: user.id,
        email: user.email!,
        leagueId: created!.id,
        leagueName: created!.name,
        leagueCode: created!.join_code,
      });
    })().catch(() => {});
  }

  return NextResponse.json({ id: created.id, name: created.name, code: created.join_code });
}

export async function GET() {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ leagues: [] });

  try {
    const db = createDraftDb();
    const { data: memberships } = await db
      .from("draft_league_members")
      .select("league_id")
      .eq("user_id", user.id);
    const ids = (memberships ?? []).map((m) => m.league_id);
    if (ids.length === 0) return NextResponse.json({ leagues: [], ready: true });

    const { data: leagues } = await db
      .from("draft_leagues")
      .select("id, name, join_code")
      .in("id", ids);

    // Member counts (small N — one grouped read).
    const { data: allMembers } = await db
      .from("draft_league_members")
      .select("league_id")
      .in("league_id", ids);
    const counts = new Map<string, number>();
    for (const m of allMembers ?? []) counts.set(m.league_id, (counts.get(m.league_id) ?? 0) + 1);

    const rows = (leagues ?? []).map((l) => ({
      id: l.id, name: l.name, code: l.join_code, member_count: counts.get(l.id) ?? 1,
    }));
    return NextResponse.json({ leagues: rows, ready: true });
  } catch {
    return NextResponse.json({ leagues: [], ready: false });
  }
}
