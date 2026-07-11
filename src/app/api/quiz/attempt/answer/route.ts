import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimitDistributed } from "@/lib/ratelimit";
import type { Json } from "@/types/database";

// Server-driven per-question answer for solo pack quizzes.
//
// Why this exists: the client no longer receives correct answers with the pack
// (answer-leak lockdown). Each committed tap is recorded here — append-only into
// the in-progress quiz_attempts row (completed_at = null) — and the correct answer
// is only revealed AFTER it has been committed. Scoring is first-attempt-only and
// is finalized from THESE recorded answers (see /api/quiz/solo-complete), so a
// script that calls this to harvest answers has thereby locked those (wrong)
// answers into its one attempt: it cannot collect-then-replay for a perfect score.
//
// Resumable, not restartable: returning to an in-progress attempt continues it; a
// question already answered keeps its first answer (idempotent). A finalized
// attempt is locked. Mirrors the server-authoritative pattern of /api/answer and
// /api/draft/wc/practice-quiz.

interface StoredAnswer {
  idx: number;
  selected: string;
  correct: boolean;
  elapsed_ms: number;
}

export async function POST(req: NextRequest) {
  const auth = await createClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { ok } = await rateLimitDistributed(`qanswer:${user.id}`, 150, 60_000);
  if (!ok) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let body: { packId?: string; idx?: number; letter?: string; elapsedMs?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { packId, idx, letter } = body;
  const elapsedMs =
    typeof body.elapsedMs === "number" && Number.isFinite(body.elapsedMs) ? body.elapsedMs : 0;
  if (
    !packId ||
    typeof packId !== "string" ||
    typeof idx !== "number" ||
    !Number.isInteger(idx) ||
    idx < 0 ||
    !["A", "B", "C", "D"].includes(letter as string)
  ) {
    return NextResponse.json({ error: "packId, idx, letter required" }, { status: 400 });
  }

  const db = createServiceClient();

  // Authoritative questions live in the pack (service client — anon/authenticated
  // no longer have SELECT on the answer-bearing questions JSONB).
  const { data: pack } = await db
    .from("quiz_packs")
    .select("questions, status")
    .eq("id", packId)
    .single();

  const questions = pack?.questions as unknown as Array<{ answer: string }> | undefined;
  if (!pack || pack.status !== "published" || !questions || idx >= questions.length) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }
  const correctAnswer = String(questions[idx].answer).toUpperCase();

  // The one attempt row for (user, pack) — first-attempt-only.
  const { data: existing } = await db
    .from("quiz_attempts")
    .select("id, answers, completed_at")
    .eq("user_id", user.id)
    .eq("pack_id", packId)
    .maybeSingle();

  const prior = (existing && Array.isArray(existing.answers) ? existing.answers : []) as unknown as StoredAnswer[];
  const already = prior.find((a) => a.idx === idx);

  // Finalized attempt, or a question already answered in this attempt: reveal only,
  // never re-record (idempotent — the first answer stands).
  if (existing?.completed_at || already) {
    return NextResponse.json({
      correct: already ? already.correct : letter === correctAnswer,
      correctAnswer,
      ...(existing?.completed_at ? { alreadyAttempted: true } : {}),
    });
  }

  const isCorrect = letter === correctAnswer;
  const record: StoredAnswer = {
    idx,
    selected: letter as string,
    correct: isCorrect,
    elapsed_ms: Math.max(0, Math.round(elapsedMs)),
  };
  const nextAnswers = [...prior, record] as unknown as Json;

  if (existing) {
    await db.from("quiz_attempts").update({ answers: nextAnswers }).eq("id", existing.id);
  } else {
    await db.from("quiz_attempts").insert({
      user_id: user.id,
      pack_id: packId,
      answers: nextAnswers,
      score: 0,
      max_score: 0,
      correct_count: 0,
      // completed_at left unset (null) → in-progress until /solo-complete finalizes.
    });
  }

  return NextResponse.json({ correct: isCorrect, correctAnswer });
}
