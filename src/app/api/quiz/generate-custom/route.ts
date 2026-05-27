import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

type Difficulty = "easy" | "medium" | "hard";
type EntityType = "club" | "records";
type Era = "all-time" | "early-pl" | "2010s" | "2020s" | "2024-25";

interface GenerateCustomBody {
  userId: string;
  entity: string;
  entityType: EntityType;
  era?: Era | string;
  difficulty?: Difficulty;
}

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

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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

  const { userId, entity, entityType, era, difficulty } = body;

  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }
  if (!entity) {
    return NextResponse.json({ error: "entity is required" }, { status: 400 });
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
      const [easy, medium, hard] = await Promise.all([
        fetchByDifficulty(supabase, entity, era, "easy", 6),
        fetchByDifficulty(supabase, entity, era, "medium", 6),
        fetchByDifficulty(supabase, entity, era, "hard", 3),
      ]);
      questions = [...easy, ...medium, ...hard];
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to fetch questions" },
      { status: 500 }
    );
  }

  if (questions.length < 8) {
    return NextResponse.json(
      { error: "Not enough questions found" },
      { status: 500 }
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pack, error: insertError } = await (supabase as any)
    .from("quiz_packs")
    .insert({
      name: packName,
      type: entityType === "club" ? "team" : "records",
      parameter: entity,
      questions: convertedQuestions,
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
