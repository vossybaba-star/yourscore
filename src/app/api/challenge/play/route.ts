import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { scoreAnswer, calculatePerfectRoundBonus, H2H_QUESTION_WINDOW_MS } from "@/lib/scoring";

// Record the caller's play in a group challenge. Server-authoritative grading —
// mirrors /api/h2h/play (same v2 scoring against the quiz pack's answers). The
// first score stands; auto-joins a link visitor who plays without joining first.

interface SubmittedAnswer { letter: "A" | "B" | "C" | "D"; elapsedMs: number }

export async function POST(req: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ok } = await rateLimitDistributed(`grp-play:${user.id}`, 30, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: { challengeId?: string; answers?: SubmittedAnswer[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const { challengeId, answers } = body;
  if (!challengeId) return NextResponse.json({ error: "challengeId required" }, { status: 400 });
  if (!Array.isArray(answers) || answers.length === 0 || answers.length > 100) {
    return NextResponse.json({ error: "Invalid answers" }, { status: 400 });
  }
  for (const a of answers) {
    if (!a || !["A", "B", "C", "D"].includes(a.letter) || typeof a.elapsedMs !== "number" || !Number.isFinite(a.elapsedMs)) {
      return NextResponse.json({ error: "Invalid answer entry" }, { status: 400 });
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;

  const { data: ch } = await db
    .from("group_challenges").select("id, quiz_pack_id, status, expires_at").eq("id", challengeId).single();
  if (!ch) return NextResponse.json({ error: "Challenge not found" }, { status: 404 });
  if (ch.status !== "open" || new Date(ch.expires_at) < new Date()) {
    return NextResponse.json({ error: "This challenge has ended" }, { status: 410 });
  }

  // Already played?
  const { data: existing } = await db
    .from("group_challenge_participants").select("score").eq("challenge_id", challengeId).eq("user_id", user.id).maybeSingle();
  if (existing && existing.score !== null) {
    return NextResponse.json({ error: "You've already played this one" }, { status: 409 });
  }

  // Grade against the pack's authoritative answers (mirrors /api/h2h/play).
  const { data: pack } = await db.from("quiz_packs").select("questions").eq("id", ch.quiz_pack_id).single();
  const questions = pack?.questions as Array<{ answer: string; difficulty?: string }> | undefined;
  if (!questions || questions.length === 0) return NextResponse.json({ error: "Quiz pack not found" }, { status: 404 });

  const n = Math.min(answers.length, questions.length);
  let score = 0, correct = 0, correctStreak = 0, wrongStreak = 0;
  for (let i = 0; i < n; i++) {
    const isCorrect = answers[i].letter === String(questions[i].answer).toUpperCase();
    const elapsedMs = Math.min(Math.max(answers[i].elapsedMs, 0), 60_000);
    const r = scoreAnswer({ isCorrect, elapsedMs, difficulty: questions[i].difficulty ?? "medium", correctStreak, wrongStreak, windowMs: H2H_QUESTION_WINDOW_MS });
    score += r.points;
    if (isCorrect) correct += 1;
    correctStreak = r.nextCorrectStreak;
    wrongStreak = r.nextWrongStreak;
  }
  score += calculatePerfectRoundBonus(correct, n);

  const { data: profile } = await db.from("profiles").select("display_name").eq("id", user.id).single();
  const playedAt = new Date().toISOString();

  if (existing) {
    // Has a row (invited/joined), score still null → record it.
    await db.from("group_challenge_participants")
      .update({ score, correct, played_at: playedAt })
      .eq("challenge_id", challengeId).eq("user_id", user.id).is("score", null);
  } else {
    // Link visitor who played without joining first → insert.
    await db.from("group_challenge_participants").insert({
      challenge_id: challengeId, user_id: user.id, display_name: profile?.display_name ?? "Player",
      score, correct, invited: false, played_at: playedAt, seen: true,
    });
  }

  return NextResponse.json({ score, correct });
}
