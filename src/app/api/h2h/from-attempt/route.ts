import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { notifyUsers } from "@/lib/notify";

// Challenge a friend with a quiz you've ALREADY played — "send your scorecard".
// Reads your authoritative stored attempt (quiz_attempts) and creates a targeted
// h2h challenge from it. If you haven't played the quiz yet, returns
// { needsPlay: true } so the client can route you into the play-then-send flow.

const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ok } = await rateLimitDistributed(`h2h-from-attempt:${user.id}`, 20, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: { packId?: string; invitedUserId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const { packId, invitedUserId } = body;
  if (!packId || !invitedUserId) return NextResponse.json({ error: "packId and invitedUserId required" }, { status: 400 });
  if (invitedUserId === user.id) return NextResponse.json({ error: "You can't challenge yourself" }, { status: 400 });

  const db = createServiceClient();

  // Your stored scorecard for this pack (authoritative — no client-trusted score).
  const { data: attempt } = await db
    .from("quiz_attempts")
    .select("score, max_score, correct_count")
    .eq("user_id", user.id)
    .eq("pack_id", packId)
    .maybeSingle();
  if (!attempt) return NextResponse.json({ needsPlay: true });

  const { data: pack } = await db
    .from("quiz_packs").select("name, questions").eq("id", packId).single();
  if (!pack) return NextResponse.json({ error: "Quiz not found" }, { status: 404 });
  const totalQuestions = Array.isArray(pack.questions) ? pack.questions.length : 0;

  const { data: profile } = await db
    .from("profiles").select("display_name").eq("id", user.id).single();

  const { data, error } = await db
    .from("h2h_challenges")
    .insert({
      quiz_pack_id: packId,
      quiz_pack_name: pack.name,
      challenger_id: user.id,
      challenger_name: profile?.display_name ?? "Someone",
      challenger_score: attempt.score ?? 0,
      challenger_correct: attempt.correct_count ?? 0,
      total_questions: totalQuestions,
      max_score: attempt.max_score ?? 0,
      invited_user_id: invitedUserId,
      status: "awaiting_opponent",
      expires_at: new Date(Date.now() + EXPIRY_MS).toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) return NextResponse.json({ error: "Could not create challenge" }, { status: 500 });

  void notifyUsers({
    userIds: [invitedUserId],
    title: "You've been challenged",
    body: `${profile?.display_name ?? "Someone"} challenged you on ${pack.name}`,
    url: `/h2h/${data.id}`,
    dedupeKey: `h2h-challenge:${data.id}`,
  });

  return NextResponse.json({ id: data.id });
}
