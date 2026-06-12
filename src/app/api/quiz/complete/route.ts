import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimitDistributed } from "@/lib/ratelimit";

interface QuizResult {
  questionId: string;
  correct: boolean;
}

interface CompleteBody {
  results: QuizResult[];
}

// Max results accepted per request — guards against unbounded-array DoS.
const MAX_RESULTS = 60;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  // Authenticate: derive the user from the session, never from the body.
  const auth = await createClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { ok } = await rateLimitDistributed(`quiz-complete:${user.id}`, 30, 60_000);
  if (!ok) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let body: CompleteBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { results } = body;

  if (!Array.isArray(results) || results.length === 0) {
    return NextResponse.json(
      { error: "results must be a non-empty array" },
      { status: 400 }
    );
  }
  if (results.length > MAX_RESULTS) {
    return NextResponse.json(
      { error: `results may not exceed ${MAX_RESULTS} items` },
      { status: 400 }
    );
  }
  // Validate every element before any DB write.
  for (const r of results) {
    if (
      !r ||
      typeof r.questionId !== "string" ||
      !UUID_RE.test(r.questionId) ||
      typeof r.correct !== "boolean"
    ) {
      return NextResponse.json(
        { error: "Each result needs a valid questionId (uuid) and boolean correct" },
        { status: 400 }
      );
    }
  }

  const supabase = createServiceClient();
  const userId = user.id;

  // One round-trip: updates this user's user_question_history rows and
  // increments question counters in two batched statements (migration 33).
  // Replaces a per-result UPDATE loop + double-UPDATE counter RPC that wrote
  // up to ~120 row versions per completion. Service-role only — p_user comes
  // from the session above, never the body.
  const allIds = results.map((r) => r.questionId);
  const correctIds = results.filter((r) => r.correct).map((r) => r.questionId);

  const { error: rpcError } = await supabase.rpc("record_quiz_results", {
    p_user: userId,
    p_qids: allIds,
    p_correct: correctIds,
  });

  if (rpcError) {
    console.error("quiz/complete record_quiz_results failed", rpcError);
    return NextResponse.json({ error: "Failed to record results" }, { status: 500 });
  }

  return NextResponse.json({ updated: results.length });
}
