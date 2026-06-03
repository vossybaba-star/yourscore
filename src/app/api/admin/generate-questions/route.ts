import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAdmin } from "@/lib/auth/admin";
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

  // Insert into DB
  const rows = (questions as Record<string, unknown>[]).map((q) => ({
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

  const { data, error } = await db.from("questions").insert(rows).select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ inserted: data?.length ?? 0, questions: rows });
}
