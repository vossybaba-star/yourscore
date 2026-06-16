import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { createDraftDb } from "@/lib/draft/server";
import { liveKick } from "@/lib/draft/live-server";
import type { PenPower, PenZone } from "@/lib/draft/pens";

const POWERS = ["under", "good", "perfect", "over"];

// One penalty kick in a live match. The aim zone is the only client input — the
// outcome resolves server-side (peppered seed) inside liveKick and streams to the
// opponent through the existing draft_live_matches realtime channel.
export async function POST(req: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in" }, { status: 401 });

  const { ok } = await rateLimitDistributed(`draft-live-kick:${user.id}`, 40, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: { matchId?: string; round?: number; shot?: number; power?: string } = {};
  try { body = await req.json(); } catch { /* below */ }
  const round = Number.isInteger(body.round) ? (body.round as number) : 0;
  const shot = Number.isInteger(body.shot) ? (body.shot as number) : -1;
  const power = (POWERS.includes(body.power ?? "") ? body.power : "good") as PenPower;
  if (!body.matchId || round < 1 || shot < 0 || shot > 8) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  try {
    const match = await liveKick(createDraftDb(), body.matchId, user.id, round, shot as PenZone, power);
    if (!match) return NextResponse.json({ error: "Match not found" }, { status: 404 });
    return NextResponse.json({ match });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
