import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAdmin } from "@/lib/auth/admin";
import { makeJoinCode } from "@/lib/club";
import type { Database } from "@/types/database";

// Admin provisioning for Club Leagues (spec §5): create (name/slug/tier + owner
// by email), list, and edit the admin-only fields (slug/tier/is_active/owner).
// Partners never touch these routes — their surface is /api/club/*.

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

async function findUserByEmail(email: string): Promise<{ id: string } | null> {
  const db = createServiceClient();
  const needle = email.trim().toLowerCase();
  // No direct email lookup in supabase-js admin API — page through users.
  // Fine at admin cadence + current user scale.
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return null;
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === needle);
    if (hit) return { id: hit.id };
    if (data.users.length < 200) return null;
  }
  return null;
}

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const db = createServiceClient();
  const [{ data: leagues }, { data: members }] = await Promise.all([
    db.from("club_leagues").select("*").order("created_at", { ascending: false }),
    db.from("club_league_members").select("league_id"),
  ]);

  const counts = new Map<string, number>();
  for (const m of members ?? []) {
    counts.set(m.league_id, (counts.get(m.league_id) ?? 0) + 1);
  }
  return NextResponse.json({
    leagues: (leagues ?? []).map((l) => ({ ...l, memberCount: counts.get(l.id) ?? 0 })),
  });
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  let body: { name?: string; slug?: string; tier?: string; ownerEmail?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = (body.name ?? "").trim();
  const slug = (body.slug ?? "").trim().toLowerCase();
  const tier = body.tier ?? "pub";
  if (!name || name.length > 60) {
    return NextResponse.json({ error: "Name required (max 60 chars)" }, { status: 400 });
  }
  if (!SLUG_RE.test(slug)) {
    return NextResponse.json(
      { error: "Slug must be 3-40 chars, lowercase letters/numbers/hyphens" },
      { status: 400 }
    );
  }
  if (!["pub", "creator", "sponsor"].includes(tier)) {
    return NextResponse.json({ error: "Invalid tier" }, { status: 400 });
  }
  if (!body.ownerEmail) {
    return NextResponse.json({ error: "ownerEmail required" }, { status: 400 });
  }

  const owner = await findUserByEmail(body.ownerEmail);
  if (!owner) {
    return NextResponse.json(
      { error: "No YourScore account with that email — ask the partner to sign up first" },
      { status: 404 }
    );
  }

  const db = createServiceClient();
  const { data: league, error } = await db
    .from("club_leagues")
    .insert({ name, slug, tier, owner_id: owner.id, join_code: makeJoinCode() })
    .select("id, slug")
    .single();
  if (error || !league) {
    const dup = (error as { code?: string } | null)?.code === "23505";
    return NextResponse.json(
      { error: dup ? "Slug already taken" : "Could not create league" },
      { status: dup ? 409 : 500 }
    );
  }

  // The owner is always also a member (board/RLS rely on the member row).
  await db
    .from("club_league_members")
    .insert({ league_id: league.id, user_id: owner.id, role: "owner" });

  return NextResponse.json({ ok: true, id: league.id, slug: league.slug });
}

export async function PATCH(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  let body: { id?: string; slug?: string; tier?: string; isActive?: boolean; name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const update: Database["public"]["Tables"]["club_leagues"]["Update"] = {};
  if (typeof body.name === "string" && body.name.trim()) update.name = body.name.trim();
  if (typeof body.slug === "string") {
    const slug = body.slug.trim().toLowerCase();
    if (!SLUG_RE.test(slug)) return NextResponse.json({ error: "Invalid slug" }, { status: 400 });
    update.slug = slug;
  }
  if (typeof body.tier === "string") {
    if (!["pub", "creator", "sponsor"].includes(body.tier)) {
      return NextResponse.json({ error: "Invalid tier" }, { status: 400 });
    }
    update.tier = body.tier;
  }
  if (typeof body.isActive === "boolean") update.is_active = body.isActive;
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const db = createServiceClient();
  const { error } = await db.from("club_leagues").update(update).eq("id", body.id);
  if (error) {
    const dup = (error as { code?: string }).code === "23505";
    return NextResponse.json(
      { error: dup ? "Slug already taken" : "Could not update" },
      { status: dup ? 409 : 500 }
    );
  }
  return NextResponse.json({ ok: true });
}
