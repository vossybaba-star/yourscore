import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { createDraftDb } from "@/lib/draft/server";
import { applyLiveSwap, setDrawChoice } from "@/lib/draft/live-server";

// Player actions during the interactive windows:
//   { matchId, slotId, newPlayer }  → a spin-and-choose swap (pregame/halftime)
//   { matchId, wantsPens }          → the draw_decision choice (penalties or not)
export async function POST(req: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in" }, { status: 401 });

  const { ok } = await rateLimitDistributed(`draft-live-swap:${user.id}`, 60, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: { matchId?: string; slotId?: string; newPlayer?: string; wantsPens?: boolean } = {};
  try { body = await req.json(); } catch { /* optional */ }
  if (!body.matchId) return NextResponse.json({ error: "Missing matchId" }, { status: 400 });

  try {
    const db = createDraftDb();
    if (typeof body.wantsPens === "boolean") {
      const match = await setDrawChoice(db, body.matchId, user.id, body.wantsPens);
      if (!match) return NextResponse.json({ error: "Match not found" }, { status: 404 });
      return NextResponse.json({ match });
    }
    if (!body.slotId || !body.newPlayer) return NextResponse.json({ error: "Missing slotId/newPlayer" }, { status: 400 });
    const match = await applyLiveSwap(db, body.matchId, user.id, body.slotId, body.newPlayer);
    return NextResponse.json({ match });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
