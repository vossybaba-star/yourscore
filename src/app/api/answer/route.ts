import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  scoreAnswer,
  TIMEOUT_PENALTY,
} from "@/lib/scoring";
import { rateLimitDistributed } from "@/lib/ratelimit";

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { ok } = await rateLimitDistributed(`answer:${user.id}`, 30, 60_000);
  if (!ok) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const body = await request.json();
  const { questionEventId, selectedAnswer, roomId } = body as {
    questionEventId: string;
    selectedAnswer: "a" | "b" | "c" | "d";
    roomId?: string;
  };

  if (!questionEventId || !selectedAnswer) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  if (!["a", "b", "c", "d"].includes(selectedAnswer)) {
    return NextResponse.json({ error: "Invalid answer" }, { status: 400 });
  }

  // Fetch event — include match_id for public match play
  const { data: eventData, error: eventErr } = await supabase
    .from("question_events")
    .select("id, closes_at, fired_at, question_id, room_id, match_id, status, sequence_number")
    .eq("id", questionEventId)
    .single();

  if (eventErr || !eventData) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const event = eventData;

  const now = new Date();
  if (now > new Date(event.closes_at)) {
    return NextResponse.json({ error: "Question closed" }, { status: 409 });
  }

  // Deduplicate
  const { data: existing } = await supabase
    .from("answers")
    .select("id")
    .eq("question_event_id", questionEventId)
    .eq("user_id", user.id)
    .single();

  if (existing) {
    return NextResponse.json({ error: "Already answered" }, { status: 409 });
  }

  // Fetch question — try questions bank first, fall back to rooms.questions_json
  // (pack-based multiplayer rooms store questions inline, not in the bank)
  const { data: questionData } = await supabase
    .from("questions")
    .select("answer, difficulty")
    .eq("id", event.question_id ?? "")
    .maybeSingle();

  let question: { answer: string; difficulty: string } | null = questionData;

  if (!question && event.room_id && event.sequence_number != null) {
    const db2 = createServiceClient();
    const { data: roomData } = await db2
      .from("rooms")
      .select("questions_json")
      .eq("id", event.room_id)
      .single();
    const qs = Array.isArray(roomData?.questions_json) ? roomData.questions_json : [];
    // questions_json is an untyped Json array; cast to read answer/difficulty
    const q = qs[(event.sequence_number as number) - 1] as { answer: string; difficulty?: string } | undefined;
    if (q) question = { answer: q.answer, difficulty: q.difficulty ?? "medium" };
  }

  if (!question) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }

  const isCorrect = selectedAnswer === question.answer.toLowerCase();
  const timeTakenMs = now.getTime() - new Date(event.fired_at ?? "").getTime();
  // Exact window from the event so speed bands scale per question duration
  const questionWindowMs = new Date(event.closes_at).getTime() - new Date(event.fired_at ?? "").getTime();

  // Effective room — either supplied or from event
  const effectiveRoomId = roomId ?? event.room_id ?? null;
  const matchId = event.match_id ?? null;

  // Fetch current streaks from room_scores or match_scores
  let currentStreak = 0; // consecutive correct
  let wrongStreak = 0;   // consecutive wrong (for comeback bonus)
  // room_scores and match_scores share the fields used below; avg/fastest only
  // exist on room_scores, so they are optional here.
  type ScoreRow = {
    current_streak: number | null;
    wrong_streak: number;
    total_score: number | null;
    correct_answers: number | null;
    total_answers: number | null;
    best_streak: number | null;
    avg_answer_speed_ms?: number | null;
    fastest_answer_ms?: number | null;
  };
  let scoreRow: ScoreRow | null = null;
  if (effectiveRoomId) {
    const { data } = await supabase
      .from("room_scores")
      .select("current_streak, wrong_streak, total_score, correct_answers, total_answers, best_streak, avg_answer_speed_ms, fastest_answer_ms")
      .eq("room_id", effectiveRoomId)
      .eq("user_id", user.id)
      .single();
    scoreRow = data;
    currentStreak = scoreRow?.current_streak ?? 0;
    wrongStreak   = scoreRow?.wrong_streak   ?? 0;
  } else if (matchId) {
    const db = createServiceClient();
    const { data } = await db
      .from("match_scores")
      .select("current_streak, wrong_streak, total_score, correct_answers, total_answers, best_streak")
      .eq("match_id", matchId)
      .eq("user_id", user.id)
      .single();
    scoreRow = data;
    currentStreak = scoreRow?.current_streak ?? 0;
    wrongStreak   = scoreRow?.wrong_streak   ?? 0;
  }

  const {
    points: pointsAwarded,
    base: basePoints,
    streakBonus,
    comebackBonus,
    nextCorrectStreak: newStreak,
    nextWrongStreak: newWrongStreak,
  } = scoreAnswer({
    isCorrect,
    elapsedMs: timeTakenMs,
    difficulty: question.difficulty ?? "medium",
    correctStreak: currentStreak,
    wrongStreak,
    windowMs: questionWindowMs,
  });

  const bestStreak     = Math.max(scoreRow?.best_streak ?? 0, newStreak);

  // Rolling avg and fastest answer speed
  const prevTotalAnswers = scoreRow?.total_answers ?? 0;
  const newTotalAnswers  = prevTotalAnswers + 1;
  const prevAvg          = scoreRow?.avg_answer_speed_ms ?? null;
  const newAvgSpeed      = prevAvg != null
    ? Math.round((prevAvg * prevTotalAnswers + timeTakenMs) / newTotalAnswers)
    : timeTakenMs;
  const newFastestSpeed  = scoreRow?.fastest_answer_ms != null
    ? Math.min(scoreRow.fastest_answer_ms, timeTakenMs)
    : timeTakenMs;

  // Insert answer
  const { error: answerErr } = await supabase.from("answers").insert({
    question_event_id: questionEventId,
    user_id: user.id,
    room_id: effectiveRoomId,
    match_id: matchId,
    selected_answer: selectedAnswer,
    is_correct: isCorrect,
    time_taken_ms: timeTakenMs,
    points_awarded: pointsAwarded,
  });

  if (answerErr) {
    return NextResponse.json({ error: answerErr.message }, { status: 500 });
  }

  // Use service client for score writes (bypasses RLS)
  const db = createServiceClient();

  // These writes are independent (different tables/RPCs, no ordering dependency),
  // so run them concurrently to cut latency on this per-answer hot path.
  const writes: PromiseLike<unknown>[] = [];

  // Write room-level score
  if (effectiveRoomId) {
    writes.push(db.from("room_scores").upsert(
      {
        room_id: effectiveRoomId,
        user_id: user.id,
        total_score: Math.max(0, (scoreRow?.total_score ?? 0) + pointsAwarded),
        correct_answers: (scoreRow?.correct_answers ?? 0) + (isCorrect ? 1 : 0),
        total_answers: newTotalAnswers,
        current_streak: newStreak,
        wrong_streak: newWrongStreak,
        best_streak: bestStreak,
        avg_answer_speed_ms: newAvgSpeed,
        fastest_answer_ms: newFastestSpeed,
      },
      { onConflict: "room_id,user_id" }
    ));
  }

  // Write match-level score (public match play)
  if (matchId) {
    writes.push(db.from("match_scores").upsert(
      {
        match_id: matchId,
        user_id: user.id,
        total_score: Math.max(0, (scoreRow?.total_score ?? 0) + pointsAwarded),
        correct_answers: (scoreRow?.correct_answers ?? 0) + (isCorrect ? 1 : 0),
        total_answers: (scoreRow?.total_answers ?? 0) + 1,
        current_streak: newStreak,
        wrong_streak: newWrongStreak,
        best_streak: bestStreak,
      },
      { onConflict: "match_id,user_id" }
    ));
  }

  // Update global profile score
  if (pointsAwarded > 0) {
    writes.push(db.rpc("increment_profile_score", { p_user_id: user.id, p_points: pointsAwarded }));
  }

  // Update all league_members rows for this user (points count in all leagues)
  if (pointsAwarded > 0 || isCorrect) {
    writes.push(db.rpc("update_league_member_stats", { p_user_id: user.id, p_points: pointsAwarded, p_is_correct: isCorrect }));
  }

  await Promise.all(writes);

  // Also flag timeout penalty so callers can surface it (not deducted here — deducted
  // server-side in /api/room/next when the question window closes)
  void TIMEOUT_PENALTY;

  return NextResponse.json({
    isCorrect,
    points: pointsAwarded,
    breakdown: {
      base: basePoints,
      streakBonus,
      comebackBonus,
    },
    newStreak,
    correctAnswer: question.answer.toLowerCase(),
  });
}
