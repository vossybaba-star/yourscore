import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { createDraftDb } from "@/lib/draft/server";
import { setReady, setBotReady } from "@/lib/draft/live-server";

// Mark the caller ready/done for the current phase (lobby start, or "done" in a
// swap window). Tries to advance the match if both sides are now ready.
export async function POST(req: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in" }, { status: 401 });

  const { ok } = await rateLimitDistributed(`draft-live-ready:${user.id}`, 60, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: { matchId?: string; bot?: boolean } = {};
  try { body = await req.json(); } catch { /* optional */ }
  if (!body.matchId) return NextResponse.json({ error: "Missing matchId" }, { status: 400 });

  try {
    // bot: true → mirror the human's Done for a bot match (fired ~2 s after the human)
    const match = body.bot
      ? await setBotReady(createDraftDb(), body.matchId, user.id)
      : await setReady(createDraftDb(), body.matchId, user.id);
    if (!match) return NextResponse.json({ error: "Match not found" }, { status: 404 });
    return NextResponse.json({ match });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
