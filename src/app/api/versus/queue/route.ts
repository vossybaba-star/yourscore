import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { queueOrPairQuiz, cancelQuizQueue, createBotQuizLobby, createShadowOfLobby } from "@/lib/versus/quiz-matchmaking";

// Quiz Battle instant-match queue (the "Find an opponent" flow).
//   queue    → poll: { status: "matched", roomId, code, opponent } | { status: "waiting" }
//              (optional packId pins the match to a picked quiz)
//   bot      → fallback after ~5s with no human: a real player's SHADOW when one
//              exists for the pack, else the CPU (optional packId, as above)
//   shadowOf → targeted revenge shadow: { userId, packId } (play THEIR run back)
//   cancel   → leave the queue
// The 38-0 equivalent lives at /api/draft/live (action: queue/cancelQueue/bot).
export async function POST(req: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to play" }, { status: 401 });

  const { ok } = await rateLimitDistributed(`quiz-mm:${user.id}`, 60, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: { action?: string; userId?: string; packId?: string } = {};
  try { body = await req.json(); } catch { /* optional */ }

  try {
    switch (body.action) {
      case "queue":
        return NextResponse.json(await queueOrPairQuiz(user.id, typeof body.packId === "string" ? body.packId : null));
      case "bot":
        return NextResponse.json(await createBotQuizLobby(user.id, typeof body.packId === "string" ? body.packId : null));
      case "shadowOf":
        if (typeof body.userId !== "string" || typeof body.packId !== "string") {
          return NextResponse.json({ error: "Missing userId or packId" }, { status: 400 });
        }
        return NextResponse.json(await createShadowOfLobby(user.id, body.userId, body.packId));
      case "cancel":
        await cancelQuizQueue(user.id);
        return NextResponse.json({ ok: true });
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
