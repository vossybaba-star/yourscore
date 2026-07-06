import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAdmin } from "@/lib/auth/admin";
import { normalizeQuestionText } from "@/lib/questions";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export async function POST(request: NextRequest) {
  // Admin-only — service client below bypasses RLS
  const denied = await requireAdmin();
  if (denied) return denied;

  // DB writes via service client (bypasses RLS)
  const db = createServiceClient();

  const { matchId, homeTeam, awayTeam, count = 10 } = await request.json();
  if (!matchId || !homeTeam || !awayTeam) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const message = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `Generate ${count} quiz questions for a live football quiz during the 2026 FIFA World Cup match: ${homeTeam} vs ${awayTeam}.

Requirements:
- Mix of difficulties: easy (2), medium (5), hard (3)
- Categories: player_fact, match_history, tournament
- Each question has exactly 4 options (a, b, c, d), one correct answer
- Include a short explanation (1-2 sentences) for the correct answer
- Questions should be engaging and relevant to this specific matchup
- timing_hint: use "pre_match", "first_half", "half_time", or "second_half"

Return ONLY a JSON array with this exact structure, no markdown:
[
  {
    "question_text": "...",
    "option_a": "...",
    "option_b": "...",
    "option_c": "...",
    "option_d": "...",
    "correct_answer": "a" | "b" | "c" | "d",
    "explanation": "...",
    "difficulty": "easy" | "medium" | "hard",
    "category": "player_fact" | "match_history" | "tournament",
    "timing_hint": "pre_match" | "first_half" | "half_time" | "second_half"
  }
]`,
      },
    ],
  });

  const raw = (message.content[0] as { type: string; text: string }).text.trim();

  let questions: unknown[];
  try {
    questions = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Failed to parse Claude response", raw }, { status: 500 });
  }

  // Duplicate guard: never insert a question whose normalized text already
  // exists in the bank (or repeats within this generated batch). Identical-text
  // rows under different ids defeat id-based session dedup.
  // Paginated — a plain select is silently capped at 1,000 rows and the bank
  // is bigger than that.
  const seenTexts = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data: existing, error: fetchError } = await db
      .from("questions")
      .select("question")
      .neq("status", "retired")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }
    for (const r of (existing ?? []) as { question: string | null }[]) {
      seenTexts.add(normalizeQuestionText(r.question));
    }
    if (!existing || existing.length < PAGE) break;
  }
  const fresh = (questions as Record<string, unknown>[]).filter((q) => {
    const key = normalizeQuestionText(q.question_text as string);
    if (!key || seenTexts.has(key)) return false;
    seenTexts.add(key);
    return true;
  });
  const skipped = (questions as unknown[]).length - fresh.length;

  // Insert into DB
  const rows = fresh.map((q) => ({
    match_id: matchId,
    question_text: q.question_text as string,
    option_a: q.option_a as string,
    option_b: q.option_b as string,
    option_c: q.option_c as string,
    option_d: q.option_d as string,
    correct_answer: q.correct_answer as "a" | "b" | "c" | "d",
    explanation: q.explanation as string,
    difficulty: q.difficulty as "easy" | "medium" | "hard",
    category: q.category as "player_fact" | "match_history" | "tournament" | "half_time",
    timing_hint: q.timing_hint as "pre_match" | "first_half" | "half_time" | "second_half",
    approved: false,
  }));

  // TODO(live-match): `rows` use the removed match-question shape
  // (question_text/option_a..d/correct_answer/match_id/approved). Migrate this
  // generator to the question bank shape (entity/options/answer) + question_events.
  if (rows.length === 0) {
    return NextResponse.json({ inserted: 0, skippedDuplicates: skipped, questions: [] });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (db as any).from("questions").insert(rows).select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ inserted: data?.length ?? 0, skippedDuplicates: skipped, questions: rows });
}
