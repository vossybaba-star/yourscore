import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { calculateBasePoints } from "@/lib/scoring";
import {
  buildRound,
  clientRound,
  dailySeed,
  gradeAnswer,
  revealFor,
  difficultyBand,
  isGameType,
  isHlTopic,
  poolSize,
  GAME_WINDOW_MS,
  ROUND_SIZE,
} from "@/lib/games/serve";

// Standalone "game type" rounds (Higher or Lower, Guess the Player), served the
// same way the WC practice quiz is: the question pool + answers are server-only
// (src/data/gates/pool.json), a round is DERIVED from a random seed, the client
// gets it answer-free with the seed, and grading re-derives the round from the
// seed. Stateless — nothing persisted; guests are fine (v1 is unranked).
//
//   { action: "draw" }                          → { seed, questions: [{idx,format,prompt,difficulty,options:[{id,label}]}] }
//   { action: "answer", seed, idx, optionId, elapsedMs } → { correct, answerId, points }
//
// `daily: true` on a draw request asks for the pinned "Today's Game" round
// (see src/lib/games/serve.ts dailySeed) instead of a fresh random one — the
// seed is derived server-side from today's London date, so it can't be
// spoofed into a different (e.g. future) day's round, and any client-sent
// `topic` is ignored so a chosen topic can't break comparability.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { type: string } }) {
  const type = params.type;
  if (!isGameType(type)) {
    return NextResponse.json({ error: "Unknown game type" }, { status: 404 });
  }
  if (poolSize(type) < 2) {
    return NextResponse.json({ error: "No questions available" }, { status: 503 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const { ok } = await rateLimitDistributed(`games:${type}:${ip}`, 120, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: { action?: string; seed?: unknown; idx?: unknown; optionId?: unknown; elapsedMs?: unknown; topic?: unknown; daily?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.action === "draw") {
    const isDaily = body.daily === true;
    // Higher-or-Lower can be scoped to one topic; it's baked into the seed so
    // grading rebuilds the same round. Anything else (incl. undefined) = mixed.
    // The pinned daily round always forces mixed — a client-chosen topic
    // would make two players' "Today's Game" rounds diverge.
    const prefix =
      !isDaily && type === "higher-lower" && typeof body.topic === "string" && isHlTopic(body.topic)
        ? body.topic
        : "mixed";
    // Daily round: seed comes from today's server-computed London date, not
    // the client, so the pinned round can't be spoofed or scouted ahead of
    // time. Everything else: a fresh random seed, same as before.
    const seed = isDaily ? dailySeed() : `${prefix}:${randomUUID()}`;
    const round = buildRound(type, seed, ROUND_SIZE);
    return NextResponse.json({ seed, window: GAME_WINDOW_MS, questions: clientRound(round) });
  }

  if (body.action === "answer") {
    if (typeof body.seed !== "string" || body.seed.length > 64) {
      return NextResponse.json({ error: "Bad seed" }, { status: 400 });
    }
    if (!Number.isInteger(body.idx) || (body.idx as number) < 0 || (body.idx as number) >= ROUND_SIZE) {
      return NextResponse.json({ error: "Bad idx" }, { status: 400 });
    }
    // -1 optionId = timeout (no valid option selected).
    const optionId = Number.isInteger(body.optionId) ? (body.optionId as number) : -1;
    // Clamp elapsed to a sane window (matches the server-authoritative pattern
    // used elsewhere) before it feeds speed scoring.
    const elapsedMs = Math.max(0, Math.min(60_000, Number(body.elapsedMs) || 0));

    const round = buildRound(type, body.seed, ROUND_SIZE);
    const q = round[body.idx as number];
    if (!q) return NextResponse.json({ error: "Bad idx" }, { status: 400 });

    const graded = gradeAnswer(round, body.idx as number, optionId);
    // A timeout / unoffered option isn't correct; still reveal the right answer.
    const correct = graded?.correct ?? false;
    const points = calculateBasePoints(correct, elapsedMs, difficultyBand(q.difficulty), GAME_WINDOW_MS);
    // Reveal the correct player's name + photo (safe post-answer).
    const reveal = revealFor(round, body.idx as number);
    return NextResponse.json({ correct, answerId: q.answerId, points, ...reveal });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
