import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { notifyUsers } from "@/lib/notify";
import {
  scoreAnswer,
  calculatePerfectRoundBonus,
  H2H_QUESTION_WINDOW_MS,
} from "@/lib/scoring";

// Server-authoritative scoring for head-to-head challenges (v2 formula).
// Uses the unified scoring engine: Base × DifficultyMult × SpeedMult + bonuses.

interface SubmittedAnswer {
  letter: "A" | "B" | "C" | "D";
  elapsedMs: number;
}

export async function POST(req: NextRequest) {
  const auth = await createClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { ok } = await rateLimitDistributed(`h2h:${user.id}`, 20, 60_000);
  if (!ok) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let body: { challengeId?: string; answers?: SubmittedAnswer[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { challengeId, answers } = body;
  if (!challengeId || typeof challengeId !== "string") {
    return NextResponse.json({ error: "challengeId required" }, { status: 400 });
  }
  if (!Array.isArray(answers) || answers.length === 0 || answers.length > 100) {
    return NextResponse.json({ error: "Invalid answers" }, { status: 400 });
  }
  for (const a of answers) {
    if (
      !a ||
      !["A", "B", "C", "D"].includes(a.letter) ||
      typeof a.elapsedMs !== "number" ||
      !Number.isFinite(a.elapsedMs)
    ) {
      return NextResponse.json({ error: "Invalid answer entry" }, { status: 400 });
    }
  }

  const db = createServiceClient();

  const { data: ch } = await db
    .from("h2h_challenges")
    .select("id, quiz_pack_id, quiz_pack_name, challenger_id, challenger_score, opponent_score, expires_at, invited_user_id")
    .eq("id", challengeId)
    .single();

  if (!ch) {
    return NextResponse.json({ error: "Challenge not found" }, { status: 404 });
  }
  if (new Date(ch.expires_at ?? 0) < new Date()) {
    return NextResponse.json({ error: "Challenge expired" }, { status: 410 });
  }
  if (ch.opponent_score !== null) {
    return NextResponse.json({ error: "Challenge already completed" }, { status: 409 });
  }
  if (ch.challenger_id === user.id) {
    return NextResponse.json({ error: "Cannot play your own challenge" }, { status: 400 });
  }
  // Targeted challenge: only the invited friend may accept. Open challenges
  // (invited_user_id null) stay link-based — anyone may play.
  if (ch.invited_user_id && ch.invited_user_id !== user.id) {
    return NextResponse.json({ error: "This challenge is for someone else" }, { status: 403 });
  }

  // Authoritative answers live in the quiz pack.
  const { data: pack } = await db
    .from("quiz_packs")
    .select("questions")
    .eq("id", ch.quiz_pack_id)
    .single();

  // quiz_packs.questions is an untyped Json column; cast to read answer/difficulty
  const questions = pack?.questions as unknown as
    | Array<{ answer: string; difficulty?: string }>
    | undefined;
  if (!questions || questions.length === 0) {
    return NextResponse.json({ error: "Quiz pack not found" }, { status: 404 });
  }

  // Grade server-side — v2 formula with difficulty + speed multipliers + bonuses.
  const n = Math.min(answers.length, questions.length);
  let score = 0;
  let correct = 0;
  let correctStreak = 0;
  let wrongStreak = 0;
  const oppAnswers: { letter: string; correct: boolean }[] = []; // per-question, for the reveal

  for (let i = 0; i < n; i++) {
    const isCorrect = answers[i].letter === String(questions[i].answer).toUpperCase();
    const elapsedMs = Math.min(Math.max(answers[i].elapsedMs, 0), 60_000); // clamp
    const difficulty = questions[i].difficulty ?? "medium";

    const result = scoreAnswer({
      isCorrect,
      elapsedMs,
      difficulty,
      correctStreak,
      wrongStreak,
      windowMs: H2H_QUESTION_WINDOW_MS,
    });

    score += result.points;
    if (isCorrect) correct += 1;
    oppAnswers.push({ letter: answers[i].letter, correct: isCorrect });
    correctStreak = result.nextCorrectStreak;
    wrongStreak = result.nextWrongStreak;
  }

  // Perfect round bonus
  score += calculatePerfectRoundBonus(correct, n);

  const { data: profile } = await db
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();

  // Conditional update guards against a race (two opponents submitting at once).
  // Cast: opponent_answers is a new column not yet in the generated types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: updated, error } = await (db as any)
    .from("h2h_challenges")
    .update({
      opponent_id: user.id,
      opponent_score: score,
      opponent_correct: correct,
      opponent_answers: oppAnswers,
      status: "complete",
    })
    .eq("id", challengeId)
    .is("opponent_score", null)
    .select("id")
    .single();

  if (error || !updated) {
    return NextResponse.json({ error: "Challenge already completed" }, { status: 409 });
  }

  // Tell the challenger their challenge just got played → opens /h2h/<id> result.
  // Won/lost framed from the challenger's side. Best-effort, opt-in-gated, deduped.
  const beat = score > (ch.challenger_score ?? 0);
  void notifyUsers({
    userIds: [ch.challenger_id],
    title: beat ? "Your score got beaten" : "Your challenge was played",
    body: `${profile?.display_name ?? "Someone"} ${beat ? "beat your" : "took on your"} ${ch.quiz_pack_name ?? "challenge"} — see the result`,
    url: `/h2h/${challengeId}`,
    dedupeKey: `h2h-result:${challengeId}`,
  });

  return NextResponse.json({
    opponentScore: score,
    opponentCorrect: correct,
    opponentName: profile?.display_name ?? "Player",
  });
}
