import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

interface QuizResult {
  questionId: string;
  correct: boolean;
}

interface CompleteBody {
  userId: string;
  results: QuizResult[];
}

export async function POST(req: NextRequest) {
  let body: CompleteBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { userId, results } = body;

  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  if (!Array.isArray(results) || results.length === 0) {
    return NextResponse.json(
      { error: "results must be a non-empty array" },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();

  // Update user_question_history correct field for each result
  for (const result of results) {
    const { error } = await supabase
      .from("user_question_history")
      .update({ correct: result.correct })
      .eq("user_id", userId)
      .eq("question_id", result.questionId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
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
    return NextResponse.json({ error: rpcError.message }, { status: 500 });
  }

  return NextResponse.json({ updated: results.length });
}
