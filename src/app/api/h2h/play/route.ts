import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { notifyUsers } from "@/lib/notify";
import { tryEmitFeedEvent } from "@/lib/fantasy/feed";
import {
  scoreAnswer,
  calculatePerfectRoundBonus,
  H2H_QUESTION_WINDOW_MS,
} from "@/lib/scoring";

/** Emit a feed event for a completed h2h — the winner only, once per
 *  completed match (P3, 6 Aug: h2h never posted to the feed at all before
 *  this). Same restraint solo-complete's own quiz_result applies ("a brag,
 *  not a confession" — see that route's own comment): a loss or a tie never
 *  posts, so a feed event here always means someone won. tryEmitFeedEvent
 *  itself excludes synthetic/bot actors and never throws, matching every
 *  other call site. */
async function emitH2hFeedResult(
  db: ReturnType<typeof createServiceClient>,
  winnerId: string, winnerScore: number, loserScore: number, title: string | null,
) {
  await tryEmitFeedEvent(db, winnerId, "h2h_result", null, { yourScore: winnerScore, opponentScore: loserScore, title });
}

// Server-authoritative scoring for head-to-head challenges (v2 formula).
// Uses the unified scoring engine: Base × DifficultyMult × SpeedMult + bonuses.
//
// Two modes on the same h2h_challenges row (Phase 3B):
//   'scorecard' (default) — the challenger already played; this route grades
//     the OPPONENT'S first and only submission. Untouched below.
//   'duel' — NEITHER side had played at challenge time. Both submissions land
//     here, graded through the exact same gradeAnswers() so a duel score is
//     never computed differently from a scorecard one. Each submission is
//     held in h2h_duel_attempts (own-row-only RLS — see migration 259) until
//     BOTH exist, at which point this copies both onto the public
//     h2h_challenges row and flips it complete — the ONLY moment a duel's
//     answers/scores become world-readable (h2h_challenges itself is public
//     read, so they can't live there any earlier).

interface SubmittedAnswer {
  letter: "A" | "B" | "C" | "D";
  elapsedMs: number;
}

/** The exact grading path both modes use — server-authoritative, base ×
 *  difficulty × speed + streak/comeback bonuses + perfect-round bonus.
 *  Factored out of the scorecard branch below (Phase 3B) so a duel
 *  submission can share it byte-for-byte rather than re-implement it. */
function gradeAnswers(
  questions: Array<{ answer: string; difficulty?: string }>,
  answers: SubmittedAnswer[],
): { score: number; correct: number; perQuestion: { letter: string; correct: boolean }[] } {
  const n = Math.min(answers.length, questions.length);
  let score = 0;
  let correct = 0;
  let correctStreak = 0;
  let wrongStreak = 0;
  const perQuestion: { letter: string; correct: boolean }[] = [];

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
    perQuestion.push({ letter: answers[i].letter, correct: isCorrect });
    correctStreak = result.nextCorrectStreak;
    wrongStreak = result.nextWrongStreak;
  }

  score += calculatePerfectRoundBonus(correct, n);
  return { score, correct, perQuestion };
}

/** Quiz Duel submission — see the file doc above for the shape. */
async function submitDuel(
  db: ReturnType<typeof createServiceClient>,
  userId: string,
  ch: { id: string; challenger_id: string; invited_user_id: string | null; quiz_pack_id: string; quiz_pack_name?: string | null },
  questions: Array<{ answer: string; difficulty?: string }>,
  answers: SubmittedAnswer[],
) {
  if (userId !== ch.challenger_id && userId !== ch.invited_user_id) {
    return NextResponse.json({ error: "This challenge is for someone else" }, { status: 403 });
  }

  const { score, correct, perQuestion } = gradeAnswers(questions, answers);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: insertErr } = await (db as any)
    .from("h2h_duel_attempts")
    .insert({ h2h_id: ch.id, user_id: userId, answers: perQuestion, score, correct_count: correct });
  if (insertErr) {
    // 23505 = unique_violation on (h2h_id, user_id) — already played their
    // side. Never regrade or overwrite a prior attempt.
    if (insertErr.code === "23505") {
      return NextResponse.json({ error: "You've already played this one" }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not save your answers" }, { status: 500 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: attempts } = await (db as any)
    .from("h2h_duel_attempts")
    .select("user_id, score, correct_count, answers")
    .eq("h2h_id", ch.id);
  const rows = (attempts ?? []) as { user_id: string; score: number; correct_count: number; answers: unknown }[];

  if (rows.length >= 2) {
    const challengerRow = rows.find((r) => r.user_id === ch.challenger_id);
    const opponentRow = rows.find((r) => r.user_id !== ch.challenger_id);
    // This copy is the ONLY time a duel's answers/scores land on the public,
    // world-readable h2h_challenges row (see the file doc above).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any)
      .from("h2h_challenges")
      .update({
        challenger_score: challengerRow?.score ?? null,
        challenger_correct: challengerRow?.correct_count ?? null,
        challenger_answers: challengerRow?.answers ?? null,
        opponent_id: opponentRow?.user_id ?? null,
        opponent_score: opponentRow?.score ?? null,
        opponent_correct: opponentRow?.correct_count ?? null,
        opponent_answers: opponentRow?.answers ?? null,
        status: "complete",
      })
      .eq("id", ch.id);

    // Feed emission (P3, 6 Aug) — winner only, once per completed duel.
    const challengerScore = challengerRow?.score ?? 0;
    const opponentScore = opponentRow?.score ?? 0;
    if (challengerScore > opponentScore) {
      await emitH2hFeedResult(db, ch.challenger_id, challengerScore, opponentScore, ch.quiz_pack_name ?? null);
    } else if (opponentScore > challengerScore && opponentRow) {
      await emitH2hFeedResult(db, opponentRow.user_id, opponentScore, challengerScore, ch.quiz_pack_name ?? null);
    }

    return NextResponse.json({
      yourScore: score,
      yourCorrect: correct,
      done: "complete",
      challengerScore: challengerRow?.score ?? null,
      challengerCorrect: challengerRow?.correct_count ?? null,
      opponentScore: opponentRow?.score ?? null,
      opponentCorrect: opponentRow?.correct_count ?? null,
    });
  }

  // Waiting on the other side — never say anything about them beyond that.
  return NextResponse.json({ yourScore: score, yourCorrect: correct, done: "waiting" });
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

  // `mode` is a new column not yet in the generated types — untyped select,
  // like opponent_answers elsewhere in this route.
  const { data: ch } = (await db
    .from("h2h_challenges")
    .select("id, quiz_pack_id, quiz_pack_name, challenger_id, challenger_score, opponent_score, expires_at, invited_user_id, mode")
    .eq("id", challengeId)
    .single()) as { data: {
      id: string; quiz_pack_id: string; quiz_pack_name: string; challenger_id: string;
      challenger_score: number | null; opponent_score: number | null; expires_at: string;
      invited_user_id: string | null; mode: string;
    } | null };

  if (!ch) {
    return NextResponse.json({ error: "Challenge not found" }, { status: 404 });
  }
  if (new Date(ch.expires_at ?? 0) < new Date()) {
    return NextResponse.json({ error: "Challenge expired" }, { status: 410 });
  }

  // Authoritative answers live in the quiz pack — fetched once, shared by
  // both modes below.
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

  if (ch.mode === "duel") {
    return submitDuel(db, user.id, ch, questions, answers);
  }

  // ── Scorecard (quiz_battle / gameday_quiz) — unchanged from before Phase 3B ──
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

  // Grade server-side — v2 formula with difficulty + speed multipliers + bonuses.
  const { score, correct, perQuestion: oppAnswers } = gradeAnswers(questions, answers);

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

  // Feed emission (P3, 6 Aug) — winner only, once per completed scorecard
  // challenge. The challenger's own score was locked in earlier (before this
  // route ever ran — see the file doc above), so this is the first and only
  // moment either side's win is known for certain.
  const challengerScore = ch.challenger_score ?? 0;
  if (score > challengerScore) {
    await emitH2hFeedResult(db, user.id, score, challengerScore, ch.quiz_pack_name ?? null);
  } else if (challengerScore > score) {
    await emitH2hFeedResult(db, ch.challenger_id, challengerScore, score, ch.quiz_pack_name ?? null);
  }

  // Tell the challenger their challenge just got played → opens /h2h/<id> result.
  // Won/lost framed from the challenger's side. Best-effort, opt-in-gated, deduped.
  const beat = score > (ch.challenger_score ?? 0);
  void notifyUsers({
    userIds: [ch.challenger_id],
    title: beat
      ? `${profile?.display_name ?? "Someone"} beat your score 😤`
      : `${profile?.display_name ?? "Someone"} took on your challenge 💪`,
    body: beat
      ? `They won on ${ch.quiz_pack_name ?? "your challenge"}. Fancy a rematch?`
      : `They couldn't beat you on ${ch.quiz_pack_name ?? "your challenge"}. See how they did.`,
    url: `/h2h/${challengeId}`,
    dedupeKey: `h2h-result:${challengeId}`,
  });

  return NextResponse.json({
    opponentScore: score,
    opponentCorrect: correct,
    opponentName: profile?.display_name ?? "Player",
  });
}
