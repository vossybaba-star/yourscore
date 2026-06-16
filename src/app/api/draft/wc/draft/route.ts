import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimitDistributed } from "@/lib/ratelimit";
import {
  rankedQuestions, draftSlots, rankedDraftStep, toSlatePlayer,
  WC_DRAFT_FORMATION, type DraftPick,
} from "@/lib/draft/wc-draft";

// Server-authoritative RANKED draft (the daily competition). The client never receives the
// answer or the seed — it asks the server for each pick's slate after answering.
//   { action: "begin" }                          → { questions[], slots[], formation }
//   { action: "slate", i, answers[], picks[] }    → { correct, correctIndex, nation, crest, players[] }
// The final XI is submitted to /api/draft/wc (start) and re-verified there.

const today = () => new Date().toISOString().slice(0, 10);

export async function POST(req: NextRequest) {
  // The draft slates are date-seeded + server-secret-peppered (not user-specific) and the
  // run isn't created here, so this works pre-sign-in — the player can draft, then sign in
  // at submit (the daily one-go gate + the real verification happen in /api/draft/wc start).
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();

  const { ok } = await rateLimitDistributed(`draft-wc-draft:${user?.id ?? "anon"}`, 120, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: { action?: string; i?: number; answers?: unknown; picks?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const date = today();

  if (body.action === "begin") {
    return NextResponse.json({ questions: rankedQuestions(date), slots: draftSlots(), formation: WC_DRAFT_FORMATION });
  }

  if (body.action === "slate") {
    const i = Number(body.i);
    const answers = (Array.isArray(body.answers) ? body.answers : []).map((v) => Number(v));
    const picks = (Array.isArray(body.picks) ? body.picks : []).map((p) => {
      const o = p as { slot?: unknown; player_season_id?: unknown };
      return { slot: String(o?.slot ?? ""), player_season_id: String(o?.player_season_id ?? "") };
    }) as DraftPick[];
    const n = draftSlots().length;
    if (!Number.isInteger(i) || i < 0 || i >= n) return NextResponse.json({ error: "Bad pick index" }, { status: 400 });
    if (answers.length !== i + 1 || picks.length !== i) return NextResponse.json({ error: "Out-of-step draft" }, { status: 400 });

    const step = rankedDraftStep(date, answers, picks, i);
    return NextResponse.json({
      correct: step.correct,
      correctIndex: step.correctIndex,
      nation: step.nation,
      crest: step.crest,
      players: step.players.map(toSlatePlayer),
    });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
