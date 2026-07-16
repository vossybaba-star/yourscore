import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimitDistributed } from "@/lib/ratelimit";
import {
  loadListForDay,
  loadListById,
  loadAttemptByShareToken,
  createOrLoadAttempt,
  saveAttempt,
  clientList,
  gradeGuess,
  hintFor,
  revealRemaining,
  pointsForHints,
  MAX_STRIKES,
  MAX_HINT_TOKENS,
  type P10List,
  type P10Attempt,
  type FoundEntry,
  type HintTaken,
} from "@/lib/games/perfect10";

// "Perfect 10" — ranked top-10 list game. Server-only answers (p10_lists.entries);
// the client only ever sees clientList() (word-length arrays) pre-solve. See
// src/lib/games/perfect10.ts for the full architecture note.
//
// Service-role reads MUST NOT hit the Vercel data cache (house gotcha) — force
// both flags below or a stale "today's list" gets pinned forever.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

interface GuestState {
  foundRanks?: number[];
  hints?: HintTaken[];
  strikes?: number;
  tokensLeft?: number;
  score?: number;
  done?: boolean;
}

function sanitizeGuestState(g: unknown): GuestState {
  const o = (g && typeof g === "object" ? g : {}) as Record<string, unknown>;
  const foundRanks = Array.isArray(o.foundRanks)
    ? o.foundRanks.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= 10)
    : [];
  const hints = Array.isArray(o.hints)
    ? o.hints.filter(
        (h): h is HintTaken =>
          !!h && typeof h === "object" && Number.isInteger((h as HintTaken).rank) && [1, 2].includes((h as HintTaken).tier)
      )
    : [];
  const strikes = Math.max(0, Math.min(MAX_STRIKES, Number(o.strikes) || 0));
  const tokensLeft = Math.max(0, Math.min(MAX_HINT_TOKENS, Number.isFinite(o.tokensLeft) ? Number(o.tokensLeft) : MAX_HINT_TOKENS));
  const score = Math.max(0, Number(o.score) || 0);
  const done = Boolean(o.done);
  return { foundRanks, hints, strikes, tokensLeft, score, done };
}

async function challengerSummary(list: P10List, shareToken: string) {
  const attempt = await loadAttemptByShareToken(shareToken);
  if (!attempt || attempt.list_id !== list.id || !attempt.user_id) return null;
  const db = createServiceClient();
  const { data: profile } = await db.from("profiles").select("display_name").eq("id", attempt.user_id).maybeSingle();
  return {
    name: (profile as { display_name?: string } | null)?.display_name ?? "A friend",
    score: attempt.score,
    foundRanks: (attempt.found ?? []).map((f: FoundEntry) => f.rank).sort((a, b) => a - b),
  };
}

function attemptForClient(list: P10List, attempt: P10Attempt) {
  const solvedRanks = (attempt.found ?? []).map((f) => f.rank);
  return {
    found: attempt.found ?? [],
    hints: (attempt.hints ?? []).map((h) => ({ rank: h.rank, tier: h.tier, text: hintFor(list, h.rank, h.tier) })),
    strikes: attempt.strikes,
    tokensLeft: attempt.tokens_left,
    score: attempt.score,
    done: attempt.done,
    reveal: attempt.done ? revealRemaining(list, solvedRanks) : undefined,
    // Opaque share token (not an answer) — lets a finisher build the challenge link.
    shareToken: attempt.share_token,
  };
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { ok } = await rateLimitDistributed(`games:perfect-10:${user?.id ?? ip}`, 120, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const action = typeof body.action === "string" ? body.action : "";

  // ── state ──────────────────────────────────────────────────────────────
  if (action === "state") {
    const challengeToken = typeof body.challenge === "string" ? body.challenge : null;

    let list: P10List | null;
    if (challengeToken) {
      const challengerAttempt = await loadAttemptByShareToken(challengeToken);
      list = challengerAttempt ? await loadListById(challengerAttempt.list_id) : await loadListForDay();
    } else {
      list = await loadListForDay();
    }
    if (!list) return NextResponse.json({ error: "No list today" }, { status: 404 });

    const payload: Record<string, unknown> = { ...clientList(list) };

    if (user) {
      const attempt = await createOrLoadAttempt(list.id, user.id);
      payload.attempt = attemptForClient(list, attempt);
    } else {
      payload.attempt = null;
    }

    if (challengeToken) {
      payload.challenge = await challengerSummary(list, challengeToken);
    }

    return NextResponse.json(payload);
  }

  // ── guess ──────────────────────────────────────────────────────────────
  if (action === "guess") {
    const listId = typeof body.listId === "string" ? body.listId : null;
    const guess = typeof body.guess === "string" ? body.guess.slice(0, 80) : "";
    if (!listId || !guess) return NextResponse.json({ error: "Missing listId or guess" }, { status: 400 });

    const list = await loadListById(listId);
    if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });

    if (user) {
      const attempt = await createOrLoadAttempt(list.id, user.id);
      if (attempt.done) return NextResponse.json({ error: "Already finished" }, { status: 400 });

      const solvedRanks = attempt.found.map((f) => f.rank);
      const result = gradeGuess(list, guess, solvedRanks);

      if (result.hit) {
        const hintsUsed = attempt.hints.filter((h) => h.rank === result.rank).length;
        const points = pointsForHints(hintsUsed);
        const found: FoundEntry[] = [
          ...attempt.found,
          { rank: result.rank, display: result.display, surname: result.surname, points, hintsUsed },
        ];
        const score = attempt.score + points;
        const done = found.length >= 10;
        const updated: P10Attempt = { ...attempt, found, score, done };
        await saveAttempt(updated);
        return NextResponse.json({
          hit: true,
          rank: result.rank,
          display: result.display,
          surname: result.surname,
          points,
          strikes: updated.strikes,
          score,
          done,
          reveal: done ? revealRemaining(list, found.map((f) => f.rank)) : undefined,
        });
      }

      const strikes = attempt.strikes + 1;
      const done = strikes >= MAX_STRIKES;
      const updated: P10Attempt = { ...attempt, strikes, done };
      await saveAttempt(updated);
      return NextResponse.json({
        hit: false,
        strikes,
        score: attempt.score,
        done,
        reveal: done ? revealRemaining(list, attempt.found.map((f) => f.rank)) : undefined,
      });
    }

    // Guest — stateless. The claimed prior state comes from the request; we
    // grade against it and hand back a delta plus an echo, same trust level as
    // the other stateless game types (client-enforced state, v1 trade-off).
    const guestState = sanitizeGuestState(body.guestState);
    if (guestState.done) return NextResponse.json({ error: "Already finished" }, { status: 400 });
    const result = gradeGuess(list, guess, guestState.foundRanks ?? []);

    if (result.hit) {
      const hintsUsed = (guestState.hints ?? []).filter((h) => h.rank === result.rank).length;
      const points = pointsForHints(hintsUsed);
      const foundRanks = [...(guestState.foundRanks ?? []), result.rank];
      const score = (guestState.score ?? 0) + points;
      const done = foundRanks.length >= 10;
      return NextResponse.json({
        hit: true,
        rank: result.rank,
        display: result.display,
        surname: result.surname,
        points,
        strikes: guestState.strikes ?? 0,
        score,
        done,
        reveal: done ? revealRemaining(list, foundRanks) : undefined,
        guestEcho: guestState,
      });
    }

    const strikes = (guestState.strikes ?? 0) + 1;
    const done = strikes >= MAX_STRIKES;
    return NextResponse.json({
      hit: false,
      strikes,
      score: guestState.score ?? 0,
      done,
      reveal: done ? revealRemaining(list, guestState.foundRanks ?? []) : undefined,
      guestEcho: guestState,
    });
  }

  // ── hint ───────────────────────────────────────────────────────────────
  if (action === "hint") {
    const listId = typeof body.listId === "string" ? body.listId : null;
    const rank = Number.isInteger(body.rank) ? (body.rank as number) : null;
    const tier = body.tier === 1 || body.tier === 2 ? (body.tier as 1 | 2) : null;
    if (!listId || !rank || rank < 1 || rank > 10 || !tier) {
      return NextResponse.json({ error: "Bad hint request" }, { status: 400 });
    }

    const list = await loadListById(listId);
    if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });

    if (user) {
      const attempt = await createOrLoadAttempt(list.id, user.id);
      if (attempt.done) return NextResponse.json({ error: "Already finished" }, { status: 400 });
      if (attempt.found.some((f) => f.rank === rank)) {
        return NextResponse.json({ error: "Rung already solved" }, { status: 400 });
      }
      const tier1Taken = attempt.hints.some((h) => h.rank === rank && h.tier === 1);
      const tier2Taken = attempt.hints.some((h) => h.rank === rank && h.tier === 2);
      if (tier === 2 && !tier1Taken) return NextResponse.json({ error: "Tier 1 hint required first" }, { status: 400 });
      if (tier === 1 && tier1Taken) return NextResponse.json({ error: "Tier 1 already taken" }, { status: 400 });
      if (tier === 2 && tier2Taken) return NextResponse.json({ error: "Tier 2 already taken" }, { status: 400 });
      if (attempt.tokens_left <= 0) return NextResponse.json({ error: "No hint tokens left" }, { status: 400 });

      const text = hintFor(list, rank, tier);
      const hints: HintTaken[] = [...attempt.hints, { rank, tier }];
      const tokensLeft = attempt.tokens_left - 1;
      await saveAttempt({ ...attempt, hints, tokens_left: tokensLeft });
      return NextResponse.json({ text, tokensLeft });
    }

    // Guest — validate against the claimed state (count + tier ordering).
    const guestState = sanitizeGuestState(body.guestState);
    if ((guestState.foundRanks ?? []).includes(rank)) {
      return NextResponse.json({ error: "Rung already solved" }, { status: 400 });
    }
    const tier1Taken = (guestState.hints ?? []).some((h) => h.rank === rank && h.tier === 1);
    const tier2Taken = (guestState.hints ?? []).some((h) => h.rank === rank && h.tier === 2);
    if (tier === 2 && !tier1Taken) return NextResponse.json({ error: "Tier 1 hint required first" }, { status: 400 });
    if (tier === 1 && tier1Taken) return NextResponse.json({ error: "Tier 1 already taken" }, { status: 400 });
    if (tier === 2 && tier2Taken) return NextResponse.json({ error: "Tier 2 already taken" }, { status: 400 });
    if ((guestState.tokensLeft ?? MAX_HINT_TOKENS) <= 0) {
      return NextResponse.json({ error: "No hint tokens left" }, { status: 400 });
    }
    const text = hintFor(list, rank, tier);
    const tokensLeft = (guestState.tokensLeft ?? MAX_HINT_TOKENS) - 1;
    return NextResponse.json({ text, tokensLeft });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
