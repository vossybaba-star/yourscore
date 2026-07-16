import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { shuffle } from "@/lib/utils";
import { dedupeByQuestionText, pickDistinctFacts } from "@/lib/questions";

type Difficulty = "easy" | "medium" | "hard";

// Allow-list for values that get concatenated into PostgREST filter strings.
// Rejecting anything else closes the .or()/.not(...in...) filter-injection vector.
const FILTER_TOKEN_RE = /^[A-Za-z0-9 _'.&-]{1,60}$/;

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
  /** Stable id of the fact this question was built from (migration 81). Null for legacy rows. */
  fact_key: string | null;
  times_answered: number;
  times_correct: number;
  created_at: string;
}

interface StartBody {
  entity?: string;
  tags?: string[];
  difficulty?: Difficulty;
  /** Topic filter — the club hub's four categories (history-honours, legends, …). */
  category?: string;
}

/**
 * Fetch a POOL of candidates (deliberately more than needed) so the caller can select from it
 * while enforcing the one-question-per-fact rule. Returns shuffled; the caller slices.
 */
async function fetchQuestions(
  supabase: ReturnType<typeof createServiceClient>,
  entity: string | undefined,
  tags: string[] | undefined,
  difficulty: Difficulty,
  seenIds: string[],
  limit: number,
  category?: string
): Promise<BankQuestion[]> {
  let query = supabase
    .from("questions")
    .select("*")
    .eq("status", "active")
    .eq("difficulty", difficulty)
    .order("created_at", { ascending: false }) // will be overridden by random below
    .limit(limit);

  // Topic filter — a fan who picks "Arsenal → Legends" gets Legends questions only.
  if (category) query = query.eq("category", category);

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

  // Postgres RANDOM() isn't reachable through the JS client, so fetch a wider pool and
  // shuffle in JS. The pool is also the headroom the fact-key selection needs: skipping a
  // question because its fact is already in this quiz means reaching further down the pool.
  const fetchLimit = limit * 4;
  const { data, error } = await query.limit(fetchLimit);

  if (error) throw new Error(error.message);
  if (!data) return [];

  // options is a jsonb column (untyped), so cast at the DB boundary.
  return shuffle(data as unknown as BankQuestion[]);
}


export async function POST(req: NextRequest) {
  // Authenticate: derive the user from the session, never from the body.
  const auth = await createClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = user.id;

  const { ok } = await rateLimitDistributed(`quiz-start:${userId}`, 30, 60_000);
  if (!ok) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let body: StartBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { entity, tags, difficulty, category } = body;

  // Validate filter inputs that get interpolated into PostgREST filter strings.
  if (entity !== undefined && (typeof entity !== "string" || !FILTER_TOKEN_RE.test(entity))) {
    return NextResponse.json({ error: "Invalid entity" }, { status: 400 });
  }
  if (category !== undefined && (typeof category !== "string" || !FILTER_TOKEN_RE.test(category))) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }
  if (tags !== undefined) {
    if (!Array.isArray(tags) || tags.length > 20 || !tags.every((t) => typeof t === "string" && FILTER_TOKEN_RE.test(t))) {
      return NextResponse.json({ error: "Invalid tags" }, { status: 400 });
    }
  }
  if (difficulty !== undefined && !["easy", "medium", "hard"].includes(difficulty)) {
    return NextResponse.json({ error: "Invalid difficulty" }, { status: 400 });
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
    // Shared across all three difficulty picks: two questions from one fact would otherwise
    // slip through at different difficulties (the easy "who did they beat" and the hard
    // "what was the score" come from the same final).
    const usedFactKeys = new Set<string>();

    if (difficulty) {
      const pool = await fetchQuestions(supabase, entity, tags, difficulty, currentSeenIds, 15, category);
      return pickDistinctFacts(pool, 15, usedFactKeys);
    }

    const [easyPool, mediumPool, hardPool] = await Promise.all([
      fetchQuestions(supabase, entity, tags, "easy", currentSeenIds, 6, category),
      fetchQuestions(supabase, entity, tags, "medium", currentSeenIds, 6, category),
      fetchQuestions(supabase, entity, tags, "hard", currentSeenIds, 3, category),
    ]);

    // Sequential selection (not parallel) so each pick sees the facts already spent.
    return [
      ...pickDistinctFacts(easyPool, 6, usedFactKeys),
      ...pickDistinctFacts(mediumPool, 6, usedFactKeys),
      ...pickDistinctFacts(hardPool, 3, usedFactKeys),
    ];
  };

  let questions = await runQueries(seenIds);

  // If fewer than 8 questions, reset oldest 50% and retry
  if (questions.length < 8 && historyRows && historyRows.length > 0) {
    const sorted = [...historyRows].sort(
      (a, b) => new Date(a.played_at ?? 0).getTime() - new Date(b.played_at ?? 0).getTime()
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

  // Text-level dedup: distinct rows with identical question text must never be
  // dealt in the same session — history-based id dedup can't catch them.
  const finalQuestions = shuffle(dedupeByQuestionText(questions));

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
