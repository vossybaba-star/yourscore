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

  // KNOWN LIMIT, read this before loosening anything below. A route that says
  // "was this letter right, and if not which was" hands over one question's key
  // per call by construction. Rate limiting is therefore the actual control on
  // bulk extraction, not a formality: it is what stops a scraper walking every
  // published pack. It raises the cost and makes the attempt visible in logs; it
  // does not make the key unobtainable. The only thing that would is withholding
  // correctness until a run is submitted, which is a product decision about how
  // the quiz feels, not an implementation detail.
  //
  // Two caps, both needed:
  //  - per caller: a full round is ~20 calls, so 150/hour still allows about
  //    seven quizzes an hour, well past real play, while halving farm rate.
  //  - per caller AND pack: 60/hour is three full runs of the SAME pack, which
  //    no real player needs, and it stops one pack being drained in a burst.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const caller = user ? `u:${user.id}` : `ip:${ip}`;
  const { ok } = await rateLimitDistributed(`quiz-answer:${caller}`, 150, 60 * 60_000);
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

  // Per-pack cap, applied only once packId is known to be well formed so a
  // malformed body can't burn a caller's budget.
  const { ok: packOk } = await rateLimitDistributed(
    `quiz-answer:${caller}:${packId}`, 60, 60 * 60_000,
  );
  if (!packOk) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
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
