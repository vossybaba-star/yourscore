import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

type Difficulty = "easy" | "medium" | "hard";

interface BankQuestion {
  id: string;
  entity: string;
  entity_type: string;
  question: string;
  options: { A: string; B: string; C: string; D: string };
  answer: "A" | "B" | "C" | "D";
  difficulty: Difficulty;
  category: string;
  era: string | null;
  tags: string[];
  status: "active" | "review" | "retired";
  source_pack_id: string | null;
  times_answered: number;
  times_correct: number;
  created_at: string;
}

interface StartBody {
  entity?: string;
  tags?: string[];
  difficulty?: Difficulty;
  userId: string;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function fetchQuestions(
  supabase: ReturnType<typeof createServiceClient>,
  entity: string | undefined,
  tags: string[] | undefined,
  difficulty: Difficulty,
  seenIds: string[],
  limit: number
): Promise<BankQuestion[]> {
  let query = supabase
    .from("questions")
    .select("*")
    .eq("status", "active")
    .eq("difficulty", difficulty)
    .order("created_at", { ascending: false }) // will be overridden by random below
    .limit(limit);

  // entity OR tags filter
  if (entity && tags && tags.length > 0) {
    query = query.or(`entity.eq.${entity},tags.cs.{${tags.join(",")}}`);
  } else if (entity) {
    query = query.eq("entity", entity);
  } else if (tags && tags.length > 0) {
    query = query.contains("tags", tags);
  }

  // exclude seen
  if (seenIds.length > 0) {
    query = query.not("id", "in", `(${seenIds.join(",")})`);
  }

  // random order via postgres trick — use rpc or raw filter; Supabase JS supports .order with ascending: false
  // Use a workaround: fetch more rows and shuffle in JS when RANDOM() isn't directly available
  // Actually Supabase supports .order('id', { ascending: false }) but not RANDOM() directly.
  // We'll fetch limit * 3 and shuffle, then slice.
  const fetchLimit = limit * 3;
  const { data, error } = await query.limit(fetchLimit);

  if (error) throw new Error(error.message);
  if (!data) return [];

  return shuffle(data as BankQuestion[]).slice(0, limit);
}

export async function POST(req: NextRequest) {
  let body: StartBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { entity, tags, difficulty, userId } = body;

  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  // entity key for history tracking
  const entityKey = entity ?? (tags && tags.length > 0 ? tags[0] : undefined);
  if (!entityKey) {
    return NextResponse.json(
      { error: "Either entity or tags must be provided" },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();

  // Fetch seen question IDs
  const { data: historyRows, error: historyError } = await supabase
    .from("user_question_history")
    .select("question_id, played_at")
    .eq("user_id", userId)
    .eq("entity", entityKey);

  if (historyError) {
    return NextResponse.json({ error: historyError.message }, { status: 500 });
  }

  let seenIds = (historyRows ?? []).map((r) => r.question_id);

  const runQueries = async (currentSeenIds: string[]): Promise<BankQuestion[]> => {
    let results: BankQuestion[] = [];

    if (difficulty) {
      const rows = await fetchQuestions(supabase, entity, tags, difficulty, currentSeenIds, 15);
      results = rows;
    } else {
      const [easy, medium, hard] = await Promise.all([
        fetchQuestions(supabase, entity, tags, "easy", currentSeenIds, 6),
        fetchQuestions(supabase, entity, tags, "medium", currentSeenIds, 6),
        fetchQuestions(supabase, entity, tags, "hard", currentSeenIds, 3),
      ]);
      results = [...easy, ...medium, ...hard];
    }

    return results;
  };

  let questions = await runQueries(seenIds);

  // If fewer than 8 questions, reset oldest 50% and retry
  if (questions.length < 8 && historyRows && historyRows.length > 0) {
    const sorted = [...historyRows].sort(
      (a, b) => new Date(a.played_at).getTime() - new Date(b.played_at).getTime()
    );
    const deleteCount = Math.ceil(sorted.length / 2);
    const toDelete = sorted.slice(0, deleteCount).map((r) => r.question_id);

    const { error: deleteError } = await supabase
      .from("user_question_history")
      .delete()
      .eq("user_id", userId)
      .eq("entity", entityKey)
      .in("question_id", toDelete);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    // Rebuild seenIds after deletion
    seenIds = seenIds.filter((id) => !toDelete.includes(id));
    questions = await runQueries(seenIds);
  }

  const finalQuestions = shuffle(questions);

  // Upsert history records (correct=null for served questions)
  if (finalQuestions.length > 0) {
    const historyInserts = finalQuestions.map((q) => ({
      user_id: userId,
      question_id: q.id,
      entity: entityKey,
      correct: null as boolean | null,
      played_at: new Date().toISOString(),
    }));

    const { error: upsertError } = await supabase
      .from("user_question_history")
      .upsert(historyInserts, {
        onConflict: "user_id,question_id",
        ignoreDuplicates: true,
      });

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ questions: finalQuestions, total: finalQuestions.length });
}
