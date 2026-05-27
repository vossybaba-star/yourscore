import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

type Difficulty = "easy" | "medium" | "hard";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;

  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  // Fetch questions with enough data to reclassify
  const { data: questions, error } = await supabase
    .from("questions")
    .select("id, difficulty, times_answered, times_correct")
    .gte("times_answered", 20);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!questions || questions.length === 0) {
    return NextResponse.json({ reclassified: 0, total_checked: 0 });
  }

  let reclassified = 0;

  for (const q of questions) {
    const difficulty = q.difficulty as Difficulty;
    const rate = q.times_correct / q.times_answered;

    let newDifficulty: Difficulty | null = null;

    if (rate > 0.75 && difficulty !== "easy") {
      newDifficulty = difficulty === "hard" ? "medium" : "easy";
    } else if (rate < 0.35 && difficulty !== "hard") {
      newDifficulty = difficulty === "easy" ? "medium" : "hard";
    }

    if (newDifficulty !== null) {
      const { error: updateError } = await supabase
        .from("questions")
        .update({ difficulty: newDifficulty })
        .eq("id", q.id);

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }

      reclassified++;
    }
  }

  return NextResponse.json({
    reclassified,
    total_checked: questions.length,
  });
}
