/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimit } from "@/lib/ratelimit";

// Server-authoritative scoring for head-to-head challenges. The opponent's
// answers are graded here against the quiz pack's stored answers and the score
// is computed server-side — the client can no longer write an arbitrary
// opponent_score. (RLS no longer permits client UPDATEs to h2h_challenges.)

const MAX_PTS = 1000;
const MIN_PTS = 100;
const DECAY_MS = 20_000;

// Mirrors the client's calcPoints, but clamps elapsedMs so a client can't claim
// a negative/huge time to game the speed bonus.
function calcPoints(elapsedMs: number): number {
  const e = Math.min(Math.max(elapsedMs, 0), DECAY_MS);
  if (e <= 0) return MAX_PTS;
  const ratio = Math.min(e / DECAY_MS, 1);
  return Math.max(MIN_PTS, Math.round(MAX_PTS - ratio * (MAX_PTS - MIN_PTS)));
}

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

  const { ok } = rateLimit(`h2h:${user.id}`, 20, 60_000);
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

  const db = createServiceClient() as any;

  const { data: ch } = await db
    .from("h2h_challenges")
    .select("id, quiz_pack_id, challenger_id, opponent_score, expires_at")
    .eq("id", challengeId)
    .single();

  if (!ch) {
    return NextResponse.json({ error: "Challenge not found" }, { status: 404 });
  }
  if (new Date(ch.expires_at) < new Date()) {
    return NextResponse.json({ error: "Challenge expired" }, { status: 410 });
  }
  if (ch.opponent_score !== null) {
    return NextResponse.json({ error: "Challenge already completed" }, { status: 409 });
  }
  if (ch.challenger_id === user.id) {
    return NextResponse.json({ error: "Cannot play your own challenge" }, { status: 400 });
  }

  // Authoritative answers live in the quiz pack.
  const { data: pack } = await db
    .from("quiz_packs")
    .select("questions")
    .eq("id", ch.quiz_pack_id)
    .single();

  const questions = pack?.questions as
    | Array<{ answer: string }>
    | undefined;
  if (!questions || questions.length === 0) {
    return NextResponse.json({ error: "Quiz pack not found" }, { status: 404 });
  }

  // Grade server-side against the stored answers.
  const n = Math.min(answers.length, questions.length);
  let score = 0;
  let correct = 0;
  for (let i = 0; i < n; i++) {
    const isCorrect = answers[i].letter === String(questions[i].answer).toUpperCase();
    if (isCorrect) {
      correct += 1;
      score += calcPoints(answers[i].elapsedMs);
    }
  }

  const { data: profile } = await db
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();

  // Conditional update guards against a race (two opponents submitting at once).
  const { data: updated, error } = await db
    .from("h2h_challenges")
    .update({
      opponent_id: user.id,
      opponent_score: score,
      opponent_correct: correct,
    })
    .eq("id", challengeId)
    .is("opponent_score", null)
    .select("id")
    .single();

  if (error || !updated) {
    return NextResponse.json({ error: "Challenge already completed" }, { status: 409 });
  }

  return NextResponse.json({
    opponentScore: score,
    opponentCorrect: correct,
    opponentName: profile?.display_name ?? "Player",
  });
}
