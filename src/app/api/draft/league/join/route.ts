import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { createDraftDb } from "@/lib/draft/server";

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

  return NextResponse.json({ id: league.id, name: league.name, code: league.join_code });
}
