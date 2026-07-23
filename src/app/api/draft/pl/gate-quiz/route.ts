import { NextRequest, NextResponse } from "next/server";
import { randomUUID, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { gateQuestion, resolveClubEntity } from "@/lib/draft/pl-quiz";
import { pensSeed } from "@/lib/draft/pens-server";

// The 38-0 PL Pro draft's quiz, server-graded. The question pool + answers are
// server-only (audit C1), so the client can't grade locally. Same stateless shape as the
// WC practice quiz: a question is DERIVED from a random seed (gateQuestion is
// deterministic per seed), the client gets it answer-free alongside the seed, and grading
// re-derives the same question from that seed. Nothing is persisted.
//
//   { action: "draw", exclude?: string[] } → { seed, sig, club, question }
//   { action: "answer", seed, sig, club, choice } → { correct, correctIndex }
//
// ── WHY THE SIGNATURE ────────────────────────────────────────────────────────
// A player is only asked neutral questions plus ones about their OWN club, so the pool a
// seed is drawn from depends on that club — the same seed with a different club derives a
// DIFFERENT question. Grading therefore has to know the club the draw used.
//
// Sending it back as a plain value would be an exploit, not a convenience: an attacker who
// answered wrong could retry the grade call with each of the ~20 clubs until one derived a
// question whose correct index happened to match what they picked (~25% per try, so a near
// certainty within a few). So the draw HMACs (seed, club) with the server secret and the
// grade call verifies it. The alternative — re-reading club_supporters on every grade —
// costs a DB round trip per question, ~22 per draft, for the same guarantee.
//
// Anonymous is fine: 38-0 drafting has always worked signed-out, and a guest simply has no
// club, so they draw the neutral pool. PL Pro is replayable rather than ranked, so there's
// nothing here to farm. Revealing correctIndex after the answer matches the UI (it
// highlights the right option) and leaks exactly as much as playing the question would.

const MAX_EXCLUDE = 400;
const DRAW_TRIES = 25; // then repeats are allowed — a long session never dead-ends

const sigFor = (seed: string, club: string | null) => pensSeed(`pl-gate:${seed}:${club ?? ""}`);

/** Constant-time compare so the signature can't be probed a character at a time. */
function sigValid(expected: string, given: unknown): boolean {
  if (typeof given !== "string" || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}

/** The signed-in player's club, in the question bank's spelling — or null for a guest, a
 *  player who hasn't picked one, or a club the bank has no questions for. */
async function currentClubEntity(): Promise<string | null> {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return null;

  // club_supporters (migration 94) postdates the generated Database types, so the typed
  // client rejects the table name. Same cast the clubs routes use — see /api/clubs/me.
  const db = createServiceClient() as unknown as SupabaseClient;
  // club_supporters' PK is (user_id, season_id) and a row is immutable within a season,
  // so the latest row is this player's club. Ordering by season means a new season's pick
  // wins automatically without this route knowing which season is current.
  const { data } = await db
    .from("club_supporters")
    .select("club")
    .eq("user_id", user.id)
    .order("season_id", { ascending: false })
    .limit(1)
    .maybeSingle();

  return resolveClubEntity((data as { club?: string } | null)?.club ?? null);
}

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

  let body: { action?: string; exclude?: unknown; seed?: unknown; sig?: unknown; club?: unknown; choice?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  if (body.action === "draw") {
    const club = await currentClubEntity();
    const exclude = new Set(
      Array.isArray(body.exclude)
        ? body.exclude.filter((v): v is string => typeof v === "string").slice(0, MAX_EXCLUDE)
        : [],
    );
    let seed = randomUUID();
    let q = gateQuestion(seed, club);
    for (let i = 0; i < DRAW_TRIES && exclude.has(q.id); i++) {
      seed = randomUUID();
      q = gateQuestion(seed, club);
    }
    return NextResponse.json({
      seed,
      sig: sigFor(seed, club),
      club,
      question: { id: q.id, prompt: q.prompt, options: q.options, category: q.category },
    });
  }

  if (body.action === "answer") {
    if (typeof body.seed !== "string" || body.seed.length > 64) {
      return NextResponse.json({ error: "Bad seed" }, { status: 400 });
    }
    const club = typeof body.club === "string" && body.club ? body.club : null;
    // The club must be the one the draw actually used, proven by the signature — otherwise
    // a wrong answer could be re-graded against a different club's question until it stuck.
    if (!sigValid(sigFor(body.seed, club), body.sig)) {
      return NextResponse.json({ error: "Bad signature" }, { status: 400 });
    }
    const choice = Number.isInteger(body.choice) ? (body.choice as number) : -1; // -1 = timeout
    const q = gateQuestion(body.seed, club);
    return NextResponse.json({ correct: choice === q.correctIndex, correctIndex: q.correctIndex });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
