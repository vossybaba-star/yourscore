import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { slugify, shuffle } from "@/lib/utils";
import { dedupeByQuestionText, pickDistinctFacts, fillToSize } from "@/lib/questions";
import type { Json } from "@/types/database";

/**
 * Legacy tiers still exist on ~1,070 older rows, but nothing new is written at these levels
 * and we no longer SERVE them — see MIX below.
 */
type Difficulty = "easy" | "medium" | "hard" | "expert" | "master";
type ServedDifficulty = "easy" | "medium" | "hard";

/**
 * The 15-question mix. Shaped to the bank we actually have, and to what's actually verified.
 *
 * It used to be 2 easy · 3 medium · 5 hard · 4 expert · 1 master — so a THIRD of every custom
 * quiz came from the expert/master tier. Two problems with that:
 *
 *   1. Those rows are the least trustworthy in the bank. They're the residue of the old
 *      free-authored cohort (the same one that produced "How many PL goals did Haaland score
 *      for Man City in 2010-11?" — he was ten), and they've never been through the fact-check
 *      gate. Serving five of them per quiz put the least verified questions in front of players.
 *   2. The bank is 10% easy / 37% medium / 53% hard, so asking for tiers that barely exist
 *      quietly under-delivered: Chelsea has FOUR easy questions in total.
 *
 * 2/5/8 matches real supply and stays inside the three tiers the difficulty rater actually
 * assigns. Labels are rated for a NEUTRAL fan, but the audience isn't neutral — someone
 * building an Arsenal quiz is usually an Arsenal fan, so 2/5/8 neutral-rated lands closer to
 * 5/8/2 as experienced.
 */
const MIX: Record<ServedDifficulty, number> = { easy: 2, medium: 5, hard: 8 };

/** Every quiz is 15 questions. The MIX above is how we'd LIKE to fill them — see fillToSize. */
const QUIZ_SIZE = 15;
type EntityType = "club" | "records" | "national";
type Era = "all-time" | "early-pl" | "2010s" | "2020s" | "2024-25";

interface GenerateCustomBody {
  entity: string;
  entityType: EntityType;
  era?: Era | string;
  difficulty?: Difficulty;
  /** Optional topic filter — the club categories (history-honours, legends, …). */
  category?: string;
}

const ENTITY_RE = /^[A-Za-z0-9 _'.&-]{1,60}$/;
const ALLOWED_ERAS = ["all-time", "early-pl", "2010s", "2020s", "2024-25"];

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
  /**
   * Which researched fact this question was built from (migration 81). Null on legacy rows.
   * Not yet in the generated Database types — 81 was applied via the Management API and
   * regenerating would drag in other branches' migrations — hence the casts at the DB boundary.
   */
  fact_key: string | null;
}

interface PackQuestion {
  question: string;
  options: { A: string; B: string; C: string; D: string };
  answer: "A" | "B" | "C" | "D";
  difficulty: Difficulty;
  category: string;
}


function buildEraLabel(era?: string): string {
  if (!era || era === "all-time") return "All Time";
  if (era === "early-pl") return "Classic (90s–00s)";
  if (era === "2010s") return "2010s";
  if (era === "2020s") return "Modern (2020s)";
  if (era === "2024-25") return "This Season";
  return "All Time";
}

function buildDiffLabel(difficulty?: string): string {
  if (!difficulty) return "Mixed";
  return difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
}

/**
 * Fetch a POOL of candidates for one difficulty — deliberately wider than needed, so the
 * caller has headroom to skip questions the player has already seen and questions that would
 * spoil each other. Returns shuffled; the caller slices.
 */
async function fetchByDifficulty(
  supabase: ReturnType<typeof createServiceClient>,
  entity: string,
  era: string | undefined,
  difficulty: Difficulty,
  limit: number,
  opts: { category?: string; seenIds?: string[] } = {}
): Promise<BankQuestion[]> {
  let query = supabase
    .from("questions")
    .select("id, entity, entity_type, question, options, answer, difficulty, category, era, fact_key")
    .eq("entity", entity)
    .eq("status", "active")
    .eq("source", "data-grounded")
    .eq("difficulty", difficulty)
    .limit(limit * 4);

  if (era && era !== "all-time") {
    query = query.eq("era", era);
  }
  if (opts.category) {
    query = query.eq("category", opts.category);
  }
  // Don't deal a question this player has answered recently. This is the thing the founder
  // actually asked to track, and the live path never did it — only the (unused) /api/quiz/start
  // did. PostgREST caps a filter string's length, so cap the exclusion list; the oldest-seen
  // questions dropping off the list is exactly the recycling behaviour we want anyway.
  const seen = (opts.seenIds ?? []).slice(0, 300);
  if (seen.length) {
    query = query.not("id", "in", `(${seen.join(",")})`);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  if (!data) return [];

  return shuffle(data as unknown as BankQuestion[]);
}

export async function POST(req: NextRequest) {
  let body: GenerateCustomBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { entity, entityType, era, difficulty, category } = body;

  // Authenticate: created_by is taken from the session, never the request body.
  const auth = await createClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = user.id;

  // Custom-pack generation is the most expensive write — limit it tightly.
  const { ok } = await rateLimitDistributed(`quiz-generate:${userId}`, 10, 60_000);
  if (!ok) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  if (!entity || typeof entity !== "string" || !ENTITY_RE.test(entity)) {
    return NextResponse.json({ error: "Invalid entity" }, { status: 400 });
  }
  if (entityType !== "club" && entityType !== "records" && entityType !== "national") {
    return NextResponse.json({ error: "Invalid entityType" }, { status: 400 });
  }
  if (era !== undefined && !ALLOWED_ERAS.includes(era)) {
    return NextResponse.json({ error: "Invalid era" }, { status: 400 });
  }
  // Only the three served tiers. `expert`/`master` still exist on ~1,070 legacy rows, but they
  // are the least-verified content in the bank and are no longer dealt — accepting them here
  // would let the picker re-open that door.
  if (difficulty !== undefined && !["easy", "medium", "hard"].includes(difficulty)) {
    return NextResponse.json({ error: "Invalid difficulty" }, { status: 400 });
  }
  if (category !== undefined && (typeof category !== "string" || !ENTITY_RE.test(category))) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }

  const eraLabel = buildEraLabel(era);
  const diffLabel = buildDiffLabel(difficulty);
  const packName = `${entity} · ${eraLabel} · ${diffLabel}`;

  const supabase = createServiceClient();

  // What has this player already been asked about this entity? The founder's one stated
  // requirement for the bank draw — and the live path never did it.
  const { data: historyRows } = await supabase
    .from("user_question_history")
    .select("question_id")
    .eq("user_id", userId)
    .eq("entity", entity);
  const seenIds = (historyRows ?? []).map((r) => r.question_id);

  // Fetch questions based on difficulty selection
  let questions: BankQuestion[];

  try {
    // Two questions built from the SAME fact can spoil each other — "which club did Arsenal
    // beat in the 2020 final?" alongside "who scored both in that win OVER CHELSEA?". One
    // shared set across all three picks, because the pair usually sits at different tiers.
    const usedFactKeys = new Set<string>();

    if (difficulty) {
      const pool = await fetchByDifficulty(supabase, entity, era, difficulty, 15, { category, seenIds });
      questions = pickDistinctFacts(pool, 15, usedFactKeys);
    } else {
      // Pools are fetched at full quiz width, not at the mix width: a club that's short on
      // easy needs enough medium and hard on hand to top the quiz back up to 15.
      const [easyPool, mediumPool, hardPool] = await Promise.all([
        fetchByDifficulty(supabase, entity, era, "easy",   QUIZ_SIZE, { category, seenIds }),
        fetchByDifficulty(supabase, entity, era, "medium", QUIZ_SIZE, { category, seenIds }),
        fetchByDifficulty(supabase, entity, era, "hard",   QUIZ_SIZE, { category, seenIds }),
      ]);
      // Picks share one usedFactKeys set, so no two questions come off the same fact.
      questions = fillToSize(
        { easy: easyPool, medium: mediumPool, hard: hardPool },
        MIX,
        QUIZ_SIZE,
        usedFactKeys
      );
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to fetch questions" },
      { status: 500 }
    );
  }

  // Identical-text rows must not land in one pack, even across difficulties.
  questions = dedupeByQuestionText(questions);

  // Thin supply ⇒ relax the difficulty mix, but NOT the guarantees. This fallback used to drop
  // every filter, which quietly re-admitted expert/master rows and questions the player had
  // just been asked. Loosening the mix is fine; serving unverified or already-seen questions
  // is not — those are the two things the draw exists to prevent.
  if (questions.length < 8) {
    let fb = supabase
      .from("questions")
      .select("id, entity, entity_type, question, options, answer, difficulty, category, era, fact_key")
      .eq("entity", entity)
      .eq("status", "active")
      .eq("source", "data-grounded")
      .in("difficulty", ["easy", "medium", "hard"])   // never the unverified legacy tiers
      .limit(80);
    if (category) fb = fb.eq("category", category);
    const seenForFallback = seenIds.slice(0, 300);
    if (seenForFallback.length) fb = fb.not("id", "in", `(${seenForFallback.join(",")})`);

    const { data: fallback } = await fb;
    if (fallback && fallback.length > 0) {
      questions = pickDistinctFacts(
        dedupeByQuestionText(shuffle(fallback as unknown as BankQuestion[])),
        15,
        new Set<string>()
      );
    }
  }

  if (questions.length < 5) {
    return NextResponse.json(
      { error: "Not enough verified questions available for this selection yet — try a different era or difficulty" },
      { status: 404 }
    );
  }

  // Convert bank questions to pack format
  const convertedQuestions: PackQuestion[] = questions.map((q) => ({
    question: q.question,
    options: q.options,
    answer: q.answer,
    difficulty: q.difficulty,
    category: q.category,
  }));

  // Insert into quiz_packs
  const { data: pack, error: insertError } = await supabase
    .from("quiz_packs")
    .insert({
      name: packName,
      type: entityType === "club" ? "club" : entityType === "national" ? "national" : "records",
      parameter: entity,
      questions: convertedQuestions as unknown as Json,
      // question_count is GENERATED ALWAYS AS jsonb_array_length(questions) — must not be inserted
      status: "published",
      created_by: userId,
      is_custom: true,
    })
    .select("id")
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  // Record what we dealt, so the NEXT quiz can skip it. Without this the exclusion above is
  // inert — which is exactly why user_question_history held 314 rows from a single user while
  // the live path had been generating packs all along.
  //
  // Written at BUILD time, not on completion: the pack is a JSONB snapshot with no link back
  // to the bank rows, so once it's built these ids are the last chance to know what was served.
  // Slight over-count (a pack built and never played still marks its questions seen) — the
  // right trade, since the failure it prevents is being asked the same thing twice.
  // Best-effort: never fail a built pack over bookkeeping.
  if (questions.length) {
    const { error: histErr } = await supabase
      .from("user_question_history")
      .upsert(
        questions.map((q) => ({ user_id: userId, question_id: q.id, entity, correct: false })),
        { onConflict: "user_id,question_id", ignoreDuplicates: true }
      );
    if (histErr) console.error("generate-custom: history write failed", histErr.message);
  }

  const slug = slugify(packName);

  return NextResponse.json({ slug, packId: pack.id });
}
