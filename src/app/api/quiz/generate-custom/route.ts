import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { slugify, shuffle } from "@/lib/utils";
import type { Json } from "@/types/database";

type Difficulty = "easy" | "medium" | "hard" | "expert" | "master";
type EntityType = "club" | "records" | "national";
type Era = "all-time" | "early-pl" | "2010s" | "2020s" | "2024-25";

interface GenerateCustomBody {
  entity: string;
  entityType: EntityType;
  era?: Era | string;
  difficulty?: Difficulty;
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

async function fetchByDifficulty(
  supabase: ReturnType<typeof createServiceClient>,
  entity: string,
  era: string | undefined,
  difficulty: Difficulty,
  limit: number
): Promise<BankQuestion[]> {
  let query = supabase
    .from("questions")
    .select("id, entity, entity_type, question, options, answer, difficulty, category, era")
    .eq("entity", entity)
    .eq("status", "active")
    .eq("source", "data-grounded")
    .eq("difficulty", difficulty)
    .limit(limit * 3);

  if (era && era !== "all-time") {
    query = query.eq("era", era);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  if (!data) return [];

  return shuffle(data as BankQuestion[]).slice(0, limit);
}

export async function POST(req: NextRequest) {
  let body: GenerateCustomBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { entity, entityType, era, difficulty } = body;

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
  if (entityType !== "club" && entityType !== "records") {
    return NextResponse.json({ error: "Invalid entityType" }, { status: 400 });
  }
  if (era !== undefined && !ALLOWED_ERAS.includes(era)) {
    return NextResponse.json({ error: "Invalid era" }, { status: 400 });
  }
  if (difficulty !== undefined && !["easy", "medium", "hard"].includes(difficulty)) {
    return NextResponse.json({ error: "Invalid difficulty" }, { status: 400 });
  }

  const eraLabel = buildEraLabel(era);
  const diffLabel = buildDiffLabel(difficulty);
  const packName = `${entity} · ${eraLabel} · ${diffLabel}`;

  const supabase = createServiceClient();

  // Fetch questions based on difficulty selection
  let questions: BankQuestion[];

  try {
    if (difficulty) {
      questions = await fetchByDifficulty(supabase, entity, era, difficulty, 15);
    } else {
      // Mixed: weighted to actual distribution (mostly hard/expert with some medium)
      // 1 easy + 3 medium + 5 hard + 5 expert + 1 master = 15
      const [easy, medium, hard, expert, master] = await Promise.all([
        fetchByDifficulty(supabase, entity, era, "easy",   2),
        fetchByDifficulty(supabase, entity, era, "medium", 3),
        fetchByDifficulty(supabase, entity, era, "hard",   5),
        fetchByDifficulty(supabase, entity, era, "expert", 4),
        fetchByDifficulty(supabase, entity, era, "master", 1),
      ]);
      questions = [...easy, ...medium, ...hard, ...expert, ...master];
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to fetch questions" },
      { status: 500 }
    );
  }

  // If we don't have enough questions, fall back without difficulty filter
  if (questions.length < 8) {
    const { data: fallback } = await supabase
      .from("questions")
      .select("id, entity, entity_type, question, options, answer, difficulty, category, era")
      .eq("entity", entity)
      .eq("status", "active")
      .eq("source", "data-grounded")
      .limit(60);
    if (fallback && fallback.length > 0) {
      questions = shuffle(fallback as BankQuestion[]).slice(0, 15);
    }
  }

  if (questions.length < 5) {
    return NextResponse.json(
      { error: "Not enough verified questions available for this club yet" },
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
      type: entityType === "club" ? "team" : "records",
      parameter: entity,
      questions: convertedQuestions as unknown as Json,
      question_count: convertedQuestions.length,
      status: "published",
      created_by: userId,
      is_custom: true,
    })
    .select("id")
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const slug = slugify(packName);

  return NextResponse.json({ slug, packId: pack.id });
}
