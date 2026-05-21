/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { calculatePoints, applyStreakMultiplier } from "@/lib/scoring";
import { rateLimit } from "@/lib/ratelimit";

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { ok } = rateLimit(`answer:${user.id}`, 10, 60_000);
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
    .select("id, closes_at, fired_at, question_id, room_id, match_id, status")
    .eq("id", questionEventId)
    .single();

  if (eventErr || !eventData) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const event = eventData as any;

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

  // Fetch question
  const { data: questionData } = await supabase
    .from("questions")
    .select("correct_answer, difficulty, explanation")
    .eq("id", event.question_id)
    .single();

  const question = questionData as any;
  const isCorrect = selectedAnswer === question.correct_answer;
  const timeTakenMs = now.getTime() - new Date(event.fired_at).getTime();
  const basePoints = calculatePoints(isCorrect, timeTakenMs, question.difficulty);

  // Effective room — either supplied or from event
  const effectiveRoomId = roomId ?? event.room_id ?? null;
  const matchId = event.match_id ?? null;

  // Fetch current streak from room_scores or match_scores
  let currentStreak = 0;
  let scoreRow: any = null;
  if (effectiveRoomId) {
    const { data } = await supabase
      .from("room_scores")
      .select("current_streak, total_score, correct_answers, total_answers, best_streak")
      .eq("room_id", effectiveRoomId)
      .eq("user_id", user.id)
      .single();
    scoreRow = data;
    currentStreak = scoreRow?.current_streak ?? 0;
  } else if (matchId) {
    // For public match play: use match_scores streak
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = createServiceClient() as any;
    const { data } = await db
      .from("match_scores")
      .select("current_streak, total_score, correct_answers, total_answers, best_streak")
      .eq("match_id", matchId)
      .eq("user_id", user.id)
      .single();
    scoreRow = data;
    currentStreak = scoreRow?.current_streak ?? 0;
  }

  const pointsAwarded = isCorrect ? applyStreakMultiplier(basePoints, currentStreak) : 0;
  const newStreak = isCorrect ? currentStreak + 1 : 0;
  const bestStreak = Math.max(scoreRow?.best_streak ?? 0, newStreak);

  // Insert answer — use any cast since generated types don't have new columns yet
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: answerErr } = await (supabase as any).from("answers").insert({
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;

  // Write room-level score
  if (effectiveRoomId) {
    await db.from("room_scores").upsert(
      {
        room_id: effectiveRoomId,
        user_id: user.id,
        total_score: (scoreRow?.total_score ?? 0) + pointsAwarded,
        correct_answers: (scoreRow?.correct_answers ?? 0) + (isCorrect ? 1 : 0),
        total_answers: (scoreRow?.total_answers ?? 0) + 1,
        current_streak: newStreak,
        best_streak: bestStreak,
      },
      { onConflict: "room_id,user_id" }
    );
  }

  // Write match-level score (public match play)
  if (matchId) {
    await db.from("match_scores").upsert(
      {
        match_id: matchId,
        user_id: user.id,
        total_score: (scoreRow?.total_score ?? 0) + pointsAwarded,
        correct_answers: (scoreRow?.correct_answers ?? 0) + (isCorrect ? 1 : 0),
        total_answers: (scoreRow?.total_answers ?? 0) + 1,
        current_streak: newStreak,
        best_streak: bestStreak,
      },
      { onConflict: "match_id,user_id" }
    );
  }

  // Update global profile score
  if (pointsAwarded > 0) {
    await db.rpc("increment_profile_score", { p_user_id: user.id, p_points: pointsAwarded });
  }

  // Update all league_members rows for this user (points count in all leagues)
  if (pointsAwarded > 0 || isCorrect) {
    await db.rpc("update_league_member_stats", { p_user_id: user.id, p_points: pointsAwarded, p_is_correct: isCorrect });
  }

  return NextResponse.json({
    isCorrect,
    points: pointsAwarded,
    correctAnswer: question.correct_answer,
  });
}
