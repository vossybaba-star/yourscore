import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { createDraftDb } from "@/lib/draft/server";
import { notifyUsers } from "@/lib/notify";

// Join a private league by its code.

export async function POST(req: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to join a league" }, { status: 401 });

  const { ok } = await rateLimitDistributed(`draft-league-join:${user.id}`, 20, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: { code?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  if (!code) return NextResponse.json({ error: "Code required" }, { status: 400 });

  const db = createDraftDb();
  const { data: league } = await db
    .from("draft_leagues")
    .select("id, name, join_code")
    .eq("join_code", code)
    .maybeSingle();
  if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 });

  const { error } = await db
    .from("draft_league_members")
    .upsert({ league_id: league.id, user_id: user.id }, { onConflict: "league_id,user_id" });
  if (error) return NextResponse.json({ error: "Could not join" }, { status: 500 });

  // Tell the league owner someone joined — 38-0 leagues notify on no other
  // channel today. Skip the owner's own join. Deduped per (league, joiner) so a
  // re-join never re-pings. Untyped handle: draft tables aren't in the generated
  // Database types.
  void (async () => {
    const raw = createServiceClient() as unknown as SupabaseClient;
    const { data: ownerRow } = await raw.from("draft_leagues").select("owner_id").eq("id", league.id).maybeSingle();
    const ownerId = (ownerRow as { owner_id?: string } | null)?.owner_id ?? null;
    if (!ownerId || ownerId === user.id) return;
    const [{ data: me }, { count }] = await Promise.all([
      raw.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
      raw.from("draft_league_members").select("user_id", { count: "exact", head: true }).eq("league_id", league.id),
    ]);
    const joiner = (me as { display_name?: string } | null)?.display_name ?? "A new player";
    const n = count ?? 1;
    await notifyUsers({
      userIds: [ownerId],
      title: `${joiner} joined your league 🎉`,
      body: `${league.name} is up to ${n} player${n === 1 ? "" : "s"}.`,
      url: `/38-0/league/${league.join_code}`,
      dedupeKey: `league-join:${league.id}:${user.id}`,
    });
  })().catch(() => {});

  return NextResponse.json({ id: league.id, name: league.name, code: league.join_code });
}
