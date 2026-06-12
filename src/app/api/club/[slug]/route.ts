import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  getLeagueBySlug,
  getMembership,
  eventWindowState,
  PUBLIC_LEAGUE_COLS,
  OWNER_EDITABLE_COLS,
} from "@/lib/club";
import type { Database } from "@/types/database";

// GET /api/club/[slug]
//   Anyone (incl. signed-out): public landing payload — branding + member count.
//   Members: full hub payload — league, role, events (with derived window state),
//   overall board (YourScore Rank scoped to members), activity feed.
// All data is read server-side via service role; the page never queries the DB
// directly, so no anon RLS policies were needed on club_* tables.

export async function GET(_req: NextRequest, { params }: { params: { slug: string } }) {
  const league = await getLeagueBySlug(params.slug);
  if (!league || !league.is_active) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const db = createServiceClient();
  const { count: memberCount } = await db
    .from("club_league_members")
    .select("user_id", { count: "exact", head: true })
    .eq("league_id", league.id);

  const auth = await createClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  const membership = user ? await getMembership(league.id, user.id) : null;

  if (!membership) {
    // Public landing view: branding only.
    const publicLeague = Object.fromEntries(
      PUBLIC_LEAGUE_COLS.split(", ").map((c) => [c, league[c as keyof typeof league]])
    );
    return NextResponse.json({
      member: false,
      league: publicLeague,
      memberCount: memberCount ?? 0,
    });
  }

  const { data: memberRows } = await db
    .from("club_league_members")
    .select("user_id")
    .eq("league_id", league.id);
  const memberIds = (memberRows ?? []).map((m) => m.user_id);

  const [{ data: events }, { data: board }, { data: feed }] = await Promise.all([
    db
      .from("club_league_events")
      .select("id, title, description, starts_at, ends_at, prize_text, status, created_at")
      .eq("league_id", league.id)
      .order("starts_at", { ascending: false })
      .limit(50),
    db.rpc("get_yourscore_leaderboard", { p_user_ids: memberIds, p_limit: 200 }),
    db.rpc("get_club_league_feed", { p_league_id: league.id, p_limit: 30 }),
  ]);

  const now = new Date();
  return NextResponse.json({
    member: true,
    role: membership.role,
    league,
    memberCount: memberCount ?? 0,
    events: (events ?? []).map((e) => ({ ...e, window: eventWindowState(e, now) })),
    board: board ?? [],
    feed: feed ?? [],
  });
}

// PATCH /api/club/[slug] — owner edits branding/copy. Whitelisted columns only;
// slug/tier/is_active/owner_id stay admin-only (slugs are on printed posters).
export async function PATCH(req: NextRequest, { params }: { params: { slug: string } }) {
  const auth = await createClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const league = await getLeagueBySlug(params.slug);
  if (!league || !league.is_active) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const membership = await getMembership(league.id, user.id);
  if (membership?.role !== "owner") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const update: Database["public"]["Tables"]["club_leagues"]["Update"] = {};
  for (const col of OWNER_EDITABLE_COLS) {
    if (!(col in body)) continue;
    const v = body[col];
    if (v !== null && typeof v !== "string") {
      return NextResponse.json({ error: `Invalid ${col}` }, { status: 400 });
    }
    const cleaned = v === "" ? null : v;
    if (col === "name") {
      if (!cleaned) return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
      update.name = cleaned;
    } else {
      update[col] = cleaned;
    }
  }
  if (update.brand_color && !/^#[0-9a-fA-F]{6}$/.test(update.brand_color)) {
    return NextResponse.json({ error: "brand_color must be #rrggbb" }, { status: 400 });
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const db = createServiceClient();
  const { error } = await db.from("club_leagues").update(update).eq("id", league.id);
  if (error) return NextResponse.json({ error: "Could not save" }, { status: 500 });

  return NextResponse.json({ ok: true });
}
