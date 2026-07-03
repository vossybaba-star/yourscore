import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { createDraftDb } from "@/lib/draft/server";
import { advanceMatch, sideOf } from "@/lib/draft/live-server";
import { ensurePool } from "@/lib/draft/pool";

// Deadline-driven, idempotent phase transition. Both clients call this when their
// local countdown hits zero; the conditional UPDATE inside advanceMatch ensures
// the transition happens exactly once.
export async function POST(req: NextRequest) {
  // The lazy-loaded player pool must be ready before any live-match logic
  // runs — bot spins, swap validation and phase advances all reach it.
  await ensurePool();

  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in" }, { status: 401 });

  const { ok } = await rateLimitDistributed(`draft-live-advance:${user.id}`, 120, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: { matchId?: string } = {};
  try { body = await req.json(); } catch { /* optional */ }
  if (!body.matchId) return NextResponse.json({ error: "Missing matchId" }, { status: 400 });

  const db = createDraftDb();
  const { data: row } = await db.from("draft_live_matches").select("p1_id, p2_id").eq("id", body.matchId).maybeSingle();
  if (!row) return NextResponse.json({ error: "Match not found" }, { status: 404 });
  if (sideOf(row as never, user.id) === null) return NextResponse.json({ error: "Not a participant" }, { status: 403 });

  const match = await advanceMatch(db, body.matchId);
  return NextResponse.json({ match });
}
