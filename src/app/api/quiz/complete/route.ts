import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

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

  // Update user_question_history correct field for each result (scoped to this user)
  for (const result of results) {
    const { error } = await supabase
      .from("user_question_history")
      .update({ correct: result.correct })
      .eq("user_id", userId)
      .eq("question_id", result.questionId);

    if (error) {
      console.error("quiz/complete history update failed", error);
      return NextResponse.json({ error: "Failed to record results" }, { status: 500 });
    }
  }

  // Atomically increment counters via RPC (avoids race conditions)
  const allIds = results.map((r) => r.questionId);
  const correctIds = results.filter((r) => r.correct).map((r) => r.questionId);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: rpcError } = await (supabase as any).rpc("increment_question_stats", {
    question_ids: allIds,
    correct_ids: correctIds,
  });

  if (rpcError) {
    console.error("quiz/complete increment_question_stats failed", rpcError);
    return NextResponse.json({ error: "Failed to record results" }, { status: 500 });
  }

  return NextResponse.json({ updated: results.length });
}
