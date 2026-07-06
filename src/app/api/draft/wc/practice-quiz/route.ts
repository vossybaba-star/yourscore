import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { deciderQuestion } from "@/lib/draft/wc-quiz";

// Practice-draft quiz, server-graded (audit C1). The question pool + answers are
// server-only; the client can no longer grade locally, so this route serves the
// practice/upgrade quizzes the same way the tie-decider works: a question is
// DERIVED from a random seed (deciderQuestion is deterministic per seed), the
// client gets it answer-free alongside the seed, and grading re-derives the same
// question from that seed — stateless, nothing persisted.
//
//   { action: "draw", exclude?: string[] } → { seed, question: {id,prompt,options,category} }
//   { action: "answer", seed, choice }     → { correct, correctIndex }
//
// Anonymous is fine (guests can play practice; nothing here ranks). Revealing
// correctIndex after the answer matches the UI (it highlights the right option)
// and leaks exactly as much as playing the question would.

const MAX_EXCLUDE = 400;
const DRAW_TRIES = 25; // then repeats are allowed — a long session never dead-ends

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const { ok } = await rateLimitDistributed(`wc-practice-quiz:${ip}`, 60, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: { action?: string; exclude?: unknown; seed?: unknown; choice?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  if (body.action === "draw") {
    const exclude = new Set(
      Array.isArray(body.exclude)
        ? body.exclude.filter((v): v is string => typeof v === "string").slice(0, MAX_EXCLUDE)
        : [],
    );
    let seed = randomUUID();
    let q = deciderQuestion(seed);
    for (let i = 0; i < DRAW_TRIES && exclude.has(q.id); i++) {
      seed = randomUUID();
      q = deciderQuestion(seed);
    }
    return NextResponse.json({
      seed,
      question: { id: q.id, prompt: q.prompt, options: q.options, category: q.category },
    });
  }

  if (body.action === "answer") {
    if (typeof body.seed !== "string" || body.seed.length > 64) {
      return NextResponse.json({ error: "Bad seed" }, { status: 400 });
    }
    const choice = Number.isInteger(body.choice) ? (body.choice as number) : -1; // -1 = timeout
    const q = deciderQuestion(body.seed);
    return NextResponse.json({ correct: choice === q.correctIndex, correctIndex: q.correctIndex });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
