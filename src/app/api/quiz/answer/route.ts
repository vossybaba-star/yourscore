import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimitDistributed } from "@/lib/ratelimit";

// Just-in-time grading. /api/challenges/pack (and /api/h2h/[id]/questions while a
// challenge is still being played) never sends an unanswered question's `answer`
// to the browser — this route is the ONLY place a per-question answer letter is
// revealed, and it reveals only the letter for the question just answered, so the
// existing wrong-answer reveal UI keeps working without shipping the whole key.
//
// This is a reveal helper, not the score of record: /api/quiz/solo-complete and
// /api/h2h/play re-grade every answer authoritatively (and are what actually
// writes a score), so a dropped or spoofed call here costs UX polish, never
// score integrity.
//
// Solo quiz is playable signed out, so this route must not require a session.

const PACK_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LETTERS = ["A", "B", "C", "D"] as const;
type Letter = (typeof LETTERS)[number];

function isLetter(v: unknown): v is Letter {
  return typeof v === "string" && (LETTERS as readonly string[]).includes(v);
}

export async function POST(req: NextRequest) {
  const auth = await createClient();
  const {
    data: { user },
  } = await auth.auth.getUser();

  // Fired once per question — a full ~20-question round (plus a retry or two)
  // needs generous headroom, so this caps at 300/hour rather than the tighter
  // per-minute limits used on write-heavy routes. Keyed by user when signed
  // in, else by IP (guest solo play has no session).
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const limitKey = user ? `quiz-answer:${user.id}` : `quiz-answer:ip:${ip}`;
  const { ok } = await rateLimitDistributed(limitKey, 300, 60 * 60_000);
  if (!ok) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let body: { packId?: unknown; idx?: unknown; letter?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { packId, idx, letter } = body;
  if (typeof packId !== "string" || !PACK_ID_RE.test(packId)) {
    return NextResponse.json({ error: "Invalid packId" }, { status: 400 });
  }
  if (typeof idx !== "number" || !Number.isInteger(idx) || idx < 0) {
    return NextResponse.json({ error: "Invalid idx" }, { status: 400 });
  }
  if (!isLetter(letter)) {
    return NextResponse.json({ error: "Invalid letter" }, { status: 400 });
  }

  const db = createServiceClient();
  const { data: pack } = await db
    .from("quiz_packs")
    .select("questions, status")
    .eq("id", packId)
    .single();

  const questions = pack?.questions as unknown as Array<{ answer: string }> | undefined;
  if (!pack || pack.status !== "published" || !questions || idx >= questions.length) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }

  const correctLetter = String(questions[idx].answer).toUpperCase();
  if (!isLetter(correctLetter)) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }

  return NextResponse.json({
    correct: letter === correctLetter,
    answer: correctLetter,
  });
}
