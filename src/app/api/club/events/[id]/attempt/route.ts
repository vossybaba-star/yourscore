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
import { getMembership, eventWindowState } from "@/lib/club";

// Server-authoritative grading for Club League event attempts. Mirrors
// /api/quiz/solo-complete, plus: membership check, event-window check, and the
// questions come from the event's immutable snapshot (not the live pack).
//
// Event scores count ONLY on the event board — deliberately never written to
// profiles.total_score / quiz_attempts, so partner-authored packs can't mint
// global YourScore points (spec §4).

const EVENT_WINDOW_MS = 30_000; // per-question; keep in sync with the play page

interface SubmittedAnswer {
  // "T" = timed out: graded as incorrect regardless of the real answer (the
  // client never knows correct letters, so it can't submit a safe wrong one).
  letter: "A" | "B" | "C" | "D" | "T";
  elapsedMs: number;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await createClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ok } = await rateLimitDistributed(`club-attempt:${user.id}`, 20, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: { answers?: SubmittedAnswer[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { answers } = body;
  if (!Array.isArray(answers) || answers.length === 0 || answers.length > 100) {
    return NextResponse.json({ error: "Invalid answers" }, { status: 400 });
  }
  for (const a of answers) {
    if (
      !a ||
      !["A", "B", "C", "D", "T"].includes(a.letter) ||
      typeof a.elapsedMs !== "number" ||
      !Number.isFinite(a.elapsedMs)
    ) {
      return NextResponse.json({ error: "Invalid answer entry" }, { status: 400 });
    }
  }

  const db = createServiceClient();
  const { data: event } = await db
    .from("club_league_events")
    .select("id, league_id, questions, starts_at, ends_at, status")
    .eq("id", params.id)
    .maybeSingle();
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const membership = await getMembership(event.league_id, user.id);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (eventWindowState(event) !== "live") {
    return NextResponse.json({ error: "Event is not live" }, { status: 409 });
  }

  // First-attempt-only: return the existing result without overwriting.
  const { data: existing } = await db
    .from("club_event_attempts")
    .select("score, max_score, correct_count")
    .eq("event_id", event.id)
    .eq("user_id", user.id)
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

  const questions = event.questions as unknown as
    | Array<{ answer: string; difficulty?: string }>
    | undefined;
  if (!questions || questions.length === 0) {
    return NextResponse.json({ error: "Event has no questions" }, { status: 500 });
  }

  // Grade server-side — v2 formula, identical to solo-complete.
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
    const isCorrect =
      answers[i].letter !== "T" &&
      answers[i].letter === String(questions[i].answer).toUpperCase();
    const elapsedMs = Math.min(Math.max(answers[i].elapsedMs, 0), EVENT_WINDOW_MS);
    const difficulty = questions[i].difficulty ?? "medium";

    const base = calculateBasePoints(isCorrect, elapsedMs, difficulty, EVENT_WINDOW_MS);
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

  // unique(event_id, user_id) guards the race between two concurrent submissions.
  const { error } = await db.from("club_event_attempts").insert({
    event_id: event.id,
    user_id: user.id,
    score,
    max_score: maxScore,
    correct_count: correct,
    answers: log as unknown as Json,
  });

  if (error) {
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

  return NextResponse.json({
    saved: true,
    alreadyAttempted: false,
    score,
    maxScore,
    correctCount: correct,
  });
}
