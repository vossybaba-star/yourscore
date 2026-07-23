import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { gateQuestion } from "@/lib/draft/pl-quiz";

// The 38-0 PL GATED draft's quiz, server-graded. The question pool + answers are
// server-only (audit C1), so the client can't grade locally. Same stateless shape as the
// WC practice quiz: a question is DERIVED from a random seed (gateQuestion is
// deterministic per seed), the client gets it answer-free alongside the seed, and grading
// re-derives the same question from that seed. Nothing is persisted.
//
//   { action: "draw", exclude?: string[] } → { seed, question: {id,prompt,options,category} }
//   { action: "answer", seed, choice }     → { correct, correctIndex }
//
// Anonymous is fine — 38-0 drafting has always worked signed-out, and PL Gated is
// replayable rather than ranked, so there's nothing here to farm. Revealing correctIndex
// after the answer matches the UI (it highlights the right option) and leaks exactly as
// much as playing the question would.

const MAX_EXCLUDE = 400;
const DRAW_TRIES = 25; // then repeats are allowed — a long session never dead-ends

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  // One gated draft is 11 questions x 2 calls = 22 requests, so 60/min left no room for
  // players sharing an IP (pub wifi, office, carrier NAT) — three drafting at once would
  // trip it. That matters more than it used to: a refused gate is now graded as a MISS
  // (see drawGateQuestion), so rate-limiting a legitimate player actively costs them
  // picks. 120 fits ~5 concurrent drafts per IP. There's nothing to farm here anyway —
  // the route is stateless and failing it no longer pays.
  const { ok } = await rateLimitDistributed(`pl-gate-quiz:${ip}`, 120, 60_000);
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
    let q = gateQuestion(seed);
    for (let i = 0; i < DRAW_TRIES && exclude.has(q.id); i++) {
      seed = randomUUID();
      q = gateQuestion(seed);
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
    const q = gateQuestion(body.seed);
    return NextResponse.json({ correct: choice === q.correctIndex, correctIndex: q.correctIndex });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
