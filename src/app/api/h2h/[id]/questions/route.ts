import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimitDistributed } from "@/lib/ratelimit";

// H2H used to read `quiz_packs.select("questions")` (full pack, `answer`
// included) straight from the browser with the anon key — the challenger,
// the opponent, and anyone else signed in with a participant's session got
// the whole answer key up front. This route replaces every one of those
// reads: service client, participant-gated, and the answer field is decided
// SERVER-side off the challenge row's own state, never a client flag.
//
//   - challenge not yet complete (opponent_score === null) → the requesting
//     participant hasn't necessarily played their side yet, so answers are
//     STRIPPED. Per-question grading for the live reveal comes from
//     /api/quiz/answer (same pack id); final scoring stays in /api/h2h/play.
//   - challenge complete (opponent_score !== null, i.e. both sides scored)
//     → answers may be included — the reveal UI legitimately shows what the
//     right answer was for a finished run.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RawQuestion {
  question: unknown;
  options: unknown;
  answer: unknown;
  difficulty: unknown;
  category: unknown;
}

/** Named-field rebuild, never a spread — see /api/challenges/pack's stripAnswers. */
function stripAnswer(q: RawQuestion) {
  return {
    question: q.question,
    options: q.options,
    difficulty: q.difficulty,
    category: q.category,
  };
}

function withAnswer(q: RawQuestion) {
  return {
    question: q.question,
    options: q.options,
    difficulty: q.difficulty,
    category: q.category,
    answer: q.answer,
  };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid challenge id" }, { status: 400 });
  }

  const auth = await createClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { ok } = await rateLimitDistributed(`h2h-questions:${user.id}`, 60, 60_000);
  if (!ok) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const db = createServiceClient();
  const { data: challenge } = await db
    .from("h2h_challenges")
    .select("challenger_id, opponent_id, invited_user_id, opponent_score, quiz_pack_id")
    .eq("id", id)
    .single();

  if (!challenge) {
    return NextResponse.json({ error: "Challenge not found" }, { status: 404 });
  }

  const isParticipant =
    user.id === challenge.challenger_id ||
    user.id === challenge.opponent_id ||
    user.id === challenge.invited_user_id;

  // An OPEN challenge (nobody claimed as opponent, nobody specifically invited)
  // is the shared-link flow: someone opens a friend's link and plays it, and
  // `opponent_id` is only stamped when they SUBMIT (/api/h2h/play sets it at
  // scoring time, not on open). Gating those on participation alone would 403
  // the exact person the link was made for. 35 such challenges were live in
  // production when this was written, so this is the common path, not an edge.
  //
  // A prospective opponent gets the STRIPPED set only: `complete` below is
  // false for an unclaimed challenge by definition (no opponent score yet), so
  // there is no route by which this branch serves an answer.
  const isOpenToAnyone =
    challenge.opponent_id === null && challenge.invited_user_id === null;

  if (!isParticipant && !isOpenToAnyone) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: pack } = await db
    .from("quiz_packs")
    .select("questions")
    .eq("id", challenge.quiz_pack_id)
    .single();

  const rawQuestions = Array.isArray(pack?.questions)
    ? (pack.questions as unknown as RawQuestion[])
    : [];

  // Answers require BOTH conditions, not just completeness: a finished run is
  // reviewable by the two people who played it, never by a passer-by who
  // happened to open the link after the fact. `isParticipant` is the load
  // bearing half — `isOpenToAnyone` callers always fall to the stripped set.
  const complete = challenge.opponent_score !== null;
  const questions = rawQuestions.map(complete && isParticipant ? withAnswer : stripAnswer);

  return NextResponse.json({ questions });
}
