import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { notifyUsers } from "@/lib/notify";

// Create a head-to-head challenge from the authenticated challenger's just-played
// result. Server-side (vs the old client insert) so it can target a specific
// friend (invited_user_id) and, when targeted, fire a notification (Phase 1: email
// — added in Step 6; push rides the rebuild). The challenger's own score is taken
// from the client, same trust model as before — only the OPPONENT's score is
// server-graded (see /api/h2h/play).

interface CreateBody {
  quizPackId?: string;
  quizPackName?: string;
  score?: number;
  correct?: number;
  totalQuestions?: number;
  maxScore?: number;
  invitedUserId?: string | null;
}

const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ok } = await rateLimitDistributed(`h2h-create:${user.id}`, 20, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: CreateBody;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const { quizPackId, quizPackName, score, correct, totalQuestions, maxScore, invitedUserId } = body;
  if (!quizPackId || !quizPackName) return NextResponse.json({ error: "Missing quiz pack" }, { status: 400 });
  for (const [k, v] of Object.entries({ score, correct, totalQuestions, maxScore })) {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
      return NextResponse.json({ error: `Invalid ${k}` }, { status: 400 });
    }
  }
  // Can't target yourself.
  if (invitedUserId && invitedUserId === user.id) {
    return NextResponse.json({ error: "You can't challenge yourself" }, { status: 400 });
  }

  const db = createServiceClient();

  const { data: profile } = await db
    .from("profiles").select("display_name").eq("id", user.id).single();

  const { data, error } = await db
    .from("h2h_challenges")
    .insert({
      quiz_pack_id: quizPackId,
      quiz_pack_name: quizPackName,
      challenger_id: user.id,
      challenger_name: profile?.display_name ?? "Someone",
      challenger_score: Math.round(score as number),
      challenger_correct: Math.round(correct as number),
      total_questions: Math.round(totalQuestions as number),
      max_score: Math.round(maxScore as number),
      invited_user_id: invitedUserId ?? null,
      status: "awaiting_opponent",
      expires_at: new Date(Date.now() + EXPIRY_MS).toISOString(),
    })
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Could not create challenge" }, { status: 500 });
  }

  // Notify a targeted friend: "X challenged you" → opens /h2h/<id>. Best-effort,
  // opt-in-gated, deduped per challenge. (Email also deferred — push covers it.)
  if (invitedUserId) {
    void notifyUsers({
      userIds: [invitedUserId],
      title: `${profile?.display_name ?? "Someone"} challenged you ⚔️`,
      body: `They've set a score on ${quizPackName}. Your turn to beat it.`,
      url: `/h2h/${data.id}`,
      dedupeKey: `h2h-challenge:${data.id}`,
    });
  }

  return NextResponse.json({ id: data.id });
}
