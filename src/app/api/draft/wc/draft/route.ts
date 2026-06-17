import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { createWcDb, activeEdition, previousEdition, resolveEdition } from "@/lib/draft/wc-server";
import {
  rankedQuestions, draftSlots, rankedDraftStep, toSlatePlayer,
  WC_DRAFT_FORMATION, type DraftPick,
} from "@/lib/draft/wc-draft";

// Server-authoritative RANKED draft (the daily competition + one-day catch-up). The client
// never receives the answer or the seed — it asks the server for each pick's slate after
// answering. A `catchup:true` request targets the IMMEDIATELY-PREVIOUS edition instead of
// the current one (the only past edition that can ever be played).
//   { action: "begin", catchup? }                → { questions[], slots[], formation } | { locked:true }
//   { action: "status" }                         → { lockedToday, catchup: { edition, available } }
//   { action: "slate", catchup?, i, answers, picks } → { correct, correctIndex, nation, crest, era, players[] }
// The final XI is submitted to /api/draft/wc (start) and re-verified there.
//
// Anti-preview: once a player passes their 6th pick (i >= LOCK_AFTER), the edition's ranked
// attempt is committed (a lock row) even before submit — so they can't read the questions,
// bail, and re-draft with the revealed answers.

const LOCK_AFTER = 6; // commit the attempt once the 7th pick (index 6) is reached

// Has this user already used (played, or drafted past pick 6 in) the given edition?
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function lockedFor(db: any, userId: string, edition: string): Promise<boolean> {
  const [lock, run] = await Promise.all([
    db.from("draft_wc_daily_locks").select("user_id").eq("user_id", userId).eq("run_date", edition).maybeSingle(),
    db.from("draft_wc_runs").select("id").eq("user_id", userId).eq("ranked", true).eq("run_date", edition).maybeSingle(),
  ]);
  return !!lock.data || !!run.data;
}

export async function POST(req: NextRequest) {
  // Slates are date-seeded + server-secret-peppered (not user-specific) and the run isn't
  // created here, so the draft itself works pre-sign-in. But ranked is a logged-in
  // competition (the entry gates sign-in), so lock bookkeeping only runs when signed in.
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();

  const { ok } = await rateLimitDistributed(`draft-wc-draft:${user?.id ?? "anon"}`, 120, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: { action?: string; i?: number; answers?: unknown; picks?: unknown; catchup?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const db = createWcDb();
  const catchup = body.catchup === true;

  if (body.action === "status") {
    // Report the current run's state AND whether a one-day catch-up is open for this user.
    const current = await activeEdition(db);
    const prev = await previousEdition(db);
    const lockedToday = user ? await lockedFor(db, user.id, current) : false;
    const catchupAvailable = !!(user && prev && !(await lockedFor(db, user.id, prev)));
    return NextResponse.json({ lockedToday, catchup: { edition: prev, available: catchupAvailable } });
  }

  // begin/slate target the current edition, or the previous one for a catch-up.
  const date = await resolveEdition(db, catchup);
  if (!date) return NextResponse.json({ error: "There's no catch-up run available right now." }, { status: 400 });

  if (body.action === "begin") {
    if (user && await lockedFor(db, user.id, date)) {
      return NextResponse.json({ locked: true, error: catchup ? "You've already played that run." : "You've already used today's ranked run — come back tomorrow." });
    }
    return NextResponse.json({ questions: rankedQuestions(date), slots: draftSlots(), formation: WC_DRAFT_FORMATION, catchup });
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

    // Commit the day once the player goes past their 6th pick (anti-preview). Best-effort.
    if (user && i >= LOCK_AFTER) {
      await db.from("draft_wc_daily_locks").upsert({ user_id: user.id, run_date: date, picks: i + 1 }, { onConflict: "user_id,run_date" });
    }

    const step = rankedDraftStep(date, user?.id ?? "anon", answers, picks, i);
    return NextResponse.json({
      correct: step.correct,
      correctIndex: step.correctIndex,
      nation: step.nation,
      crest: step.crest,
      era: step.era,
      players: step.players.map(toSlatePlayer),
    });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
