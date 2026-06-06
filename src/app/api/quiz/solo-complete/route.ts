import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimitDistributed } from "@/lib/ratelimit";
import type { Json } from "@/types/database";
import {
  calculateBasePoints,
  calculateStreakBonus,
  calculateComebackBonus,
  calculatePerfectRoundBonus,
  maxPointsForDifficulty,
} from "@/lib/scoring";

// Server-authoritative scoring for solo challenges.
// The browser may show optimistic per-question points for UX, but the SAVED
// quiz_attempts row is graded here from the pack's authoritative answers — the
// client never writes its own score (the insert RLS policy was dropped in
// migration 12). Mirrors /api/h2h/play.

const CHALLENGE_WINDOW_MS = 30_000; // keep in sync with challenges/[slug]/page.tsx

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

  const { ok } = await rateLimitDistributed(`solo:${user.id}`, 20, 60_000);
  if (!ok) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let body: { packId?: string; answers?: SubmittedAnswer[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { packId, answers } = body;
  if (!packId || typeof packId !== "string") {
    return NextResponse.json({ error: "packId required" }, { status: 400 });
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

  // First-attempt-only: if a row already exists, return it without overwriting.
  const { data: existing } = await db
    .from("quiz_attempts")
    .select("score, max_score, correct_count")
    .eq("user_id", user.id)
    .eq("pack_id", packId)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({
      saved: false,
      alreadyAttempted: true,
      score: existing.score,
      maxScore: existing.max_score,
      correctCount: existing.correct_count,
    });
  }

  // Authoritative questions/answers live in the pack.
  const { data: pack } = await db
    .from("quiz_packs")
    .select("questions, status")
    .eq("id", packId)
    .single();

  const questions = pack?.questions as unknown as
    | Array<{ answer: string; difficulty?: string }>
    | undefined;
  if (!pack || pack.status !== "published" || !questions || questions.length === 0) {
    return NextResponse.json({ error: "Quiz pack not found" }, { status: 404 });
  }

  // Grade server-side — v2 formula with difficulty + speed multipliers + bonuses.
  const n = Math.min(answers.length, questions.length);
  let score = 0;
  let correct = 0;
  let correctStreak = 0;
  let wrongStreak = 0;
  const log: Array<{
    idx: number;
    selected: string;
    correct: boolean;
    points: number;
    elapsed_ms: number;
  }> = [];

  for (let i = 0; i < n; i++) {
    const isCorrect = answers[i].letter === String(questions[i].answer).toUpperCase();
    const elapsedMs = Math.min(Math.max(answers[i].elapsedMs, 0), CHALLENGE_WINDOW_MS); // clamp
    const difficulty = questions[i].difficulty ?? "medium";

    const base = calculateBasePoints(isCorrect, elapsedMs, difficulty, CHALLENGE_WINDOW_MS);
    const streakBonus = calculateStreakBonus(correctStreak, isCorrect);
    const comebackBonus = calculateComebackBonus(wrongStreak, isCorrect);
    const pts = base + streakBonus + comebackBonus;

    score += pts;
    if (isCorrect) {
      correct += 1;
      correctStreak += 1;
      wrongStreak = 0;
    } else {
      correctStreak = 0;
      wrongStreak += 1;
    }
    log.push({ idx: i, selected: answers[i].letter, correct: isCorrect, points: pts, elapsed_ms: elapsedMs });
  }

  score += calculatePerfectRoundBonus(correct, n);
  const maxScore = questions.reduce(
    (s, q) => s + maxPointsForDifficulty(q.difficulty ?? "medium"),
    0
  );

  // Insert authoritatively. Unique (user_id, pack_id) guards a race between two
  // concurrent submissions — treat a conflict as "already attempted".
  const { error } = await db.from("quiz_attempts").insert({
    user_id: user.id,
    pack_id: packId,
    score,
    max_score: maxScore,
    correct_count: correct,
    answers: log as unknown as Json,
  });

  if (error) {
    // 23505 = unique_violation → another submission landed first.
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json({
        saved: false,
        alreadyAttempted: true,
        score,
        maxScore,
        correctCount: correct,
      });
    }
    return NextResponse.json({ error: "Could not save attempt" }, { status: 500 });
  }

  return NextResponse.json({ saved: true, alreadyAttempted: false, score, maxScore, correctCount: correct });
}
