import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

// Answer-free question lookup for a live question_event. Both the match page's
// realtime listener and the room play page's bank-question fallback used to
// read `questions` (the full row, `answer` included) straight from the
// browser with the anon key the moment a question fired. This route replaces
// both reads: resolve question_id from the fired event, then hand back only
// the fields the player-facing UI renders. Grading for both callers already
// goes through /api/answer (service role, server-graded) — untouched here.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const eventId = searchParams.get("eventId");
  if (!eventId || !UUID_RE.test(eventId)) {
    return NextResponse.json({ error: "eventId required" }, { status: 400 });
  }

  const db = createServiceClient();

  const { data: event } = await db
    .from("question_events")
    .select("question_id")
    .eq("id", eventId)
    .single();

  if (!event?.question_id) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const { data: q } = await db
    .from("questions")
    .select("id, question, options, difficulty, category, verification_note")
    .eq("id", event.question_id)
    .single();

  if (!q) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }

  // Named fields only — a spread would carry `answer` straight to the browser
  // the moment a column gets added to the bank.
  return NextResponse.json({
    question: {
      id: q.id,
      question: q.question,
      options: q.options,
      difficulty: q.difficulty,
      category: q.category,
      verification_note: q.verification_note,
    },
  });
}
