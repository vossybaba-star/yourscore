import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  calculateBasePoints,
  calculatePerfectRoundBonus,
  maxPointsForDifficulty,
  scoreAnswer,
} from "@/lib/scoring";
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
  topicFromSeed,
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

// The board. Best per player, never per run — see migration 113 for why.
// `you` comes back separately so a player outside the visible slice can still
// be shown their own standing without shipping the whole table to the client.
export async function GET(req: NextRequest, { params }: { params: { type: string } }) {
  const type = params.type;
  if (!isGameType(type)) {
    return NextResponse.json({ error: "Unknown game type" }, { status: 404 });
  }

  const limitRaw = Number(new URL(req.url).searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, limitRaw)) : 25;

  const service = createServiceClient();
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id ?? null;

  const [board, standing] = await Promise.all([
    service.rpc("game_board", { p_game: type, p_limit: limit }),
    userId
      ? service.rpc("game_my_standing", { p_game: type, p_user: userId })
      : Promise.resolve({ data: null, error: null }),
  ]);

  const entries = (board.data ?? []).map((r) => ({
    userId: r.user_id,
    username: r.username,
    avatarUrl: r.avatar_url,
    best: r.best,
    plays: Number(r.plays),
  }));

  // game_my_standing always returns one row; best is null when they've never
  // finished a round, which reads as "no standing yet" rather than rank 0.
  const mine = Array.isArray(standing.data) ? standing.data[0] : null;
  const you =
    mine && mine.best !== null
      ? { best: mine.best, plays: Number(mine.plays), rank: mine.rank }
      : null;

  return NextResponse.json({ entries, you });
}

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

  let body: { action?: string; seed?: unknown; idx?: unknown; optionId?: unknown; elapsedMs?: unknown; topic?: unknown; daily?: unknown; answers?: unknown };
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

  // A finished run, banked. The client sends the seed plus the answers it gave;
  // the round is rebuilt from that seed and EVERY answer re-graded here, so the
  // stored score is the server's own number and a client cannot post one.
  //
  // Signed in  → saved, and the response carries the rank it earned.
  // Guest      → nothing saved, but the rank it WOULD earn comes back, which is
  //              what the results screen shows to make the sign-up ask concrete.
  if (body.action === "complete") {
    if (typeof body.seed !== "string" || body.seed.length > 64) {
      return NextResponse.json({ error: "Bad seed" }, { status: 400 });
    }
    if (!Array.isArray(body.answers) || body.answers.length > ROUND_SIZE) {
      return NextResponse.json({ error: "Bad answers" }, { status: 400 });
    }

    const round = buildRound(type, body.seed, ROUND_SIZE);
    const sent = new Map<number, { optionId: number; elapsedMs: number }>();
    for (const raw of body.answers as unknown[]) {
      const a = raw as { idx?: unknown; optionId?: unknown; elapsedMs?: unknown };
      if (!Number.isInteger(a.idx) || (a.idx as number) < 0 || (a.idx as number) >= round.length) continue;
      sent.set(a.idx as number, {
        optionId: Number.isInteger(a.optionId) ? (a.optionId as number) : -1,
        elapsedMs: Math.max(0, Math.min(60_000, Number(a.elapsedMs) || 0)),
      });
    }

    // Same arithmetic the client runs while playing, in the same order, so the
    // banked total matches the number the player watched tick up. An unanswered
    // index is a timeout: wrong, zero points, and it still breaks the streak.
    let score = 0;
    let correctCount = 0;
    let maxScore = 0;
    let correctStreak = 0;
    let wrongStreak = 0;
    let fastestMs: number | null = null;

    round.forEach((q, idx) => {
      const band = difficultyBand(q.difficulty);
      maxScore += maxPointsForDifficulty(band);

      const a = sent.get(idx);
      const elapsedMs = a?.elapsedMs ?? GAME_WINDOW_MS;
      const correct = a ? (gradeAnswer(round, idx, a.optionId)?.correct ?? false) : false;
      const base = calculateBasePoints(correct, elapsedMs, band, GAME_WINDOW_MS);
      const { streakBonus, comebackBonus, nextCorrectStreak, nextWrongStreak } = scoreAnswer({
        isCorrect: correct,
        elapsedMs,
        difficulty: band,
        correctStreak,
        wrongStreak,
        windowMs: GAME_WINDOW_MS,
      });
      if (correct) {
        score += base + streakBonus + comebackBonus;
        correctCount += 1;
        if (fastestMs === null || elapsedMs < fastestMs) fastestMs = elapsedMs;
      }
      correctStreak = nextCorrectStreak;
      wrongStreak = nextWrongStreak;
    });
    score += calculatePerfectRoundBonus(correctCount, round.length);

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth?.user?.id ?? null;
    const service = createServiceClient();

    let saved = false;
    if (userId) {
      const { error } = await service.from("game_scores").insert({
        user_id: userId,
        game: type,
        topic: topicFromSeed(body.seed),
        seed: body.seed,
        score,
        max_score: maxScore,
        correct_count: correctCount,
        total_questions: round.length,
        fastest_ms: fastestMs,
      });
      // 23505 = this seed is already banked for this player (a replayed round,
      // a double tap, or a guest claim that fired twice). Not an error: the
      // score is already on the board, so report it as saved.
      saved = !error || error.code === "23505";
    }

    // Rank is BEST-per-player, so it reads the same for both states: "where you
    // are" once saved, "where you'd be" while still a guest.
    const { data: rank } = await service.rpc("game_rank", { p_game: type, p_score: score });

    return NextResponse.json({
      saved,
      score,
      maxScore,
      correctCount,
      total: round.length,
      rank: typeof rank === "number" ? rank : null,
    });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
