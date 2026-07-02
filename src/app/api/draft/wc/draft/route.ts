import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { ensurePool } from "@/lib/draft/pool";
import { createWcDb, activeEdition, previousEdition, pastEditions, resolveEdition } from "@/lib/draft/wc-server";
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

// One cell of the WC-tab edition strip: today + every past edition, each tagged with THIS
// user's state — played (→ the inline stat peek), open (→ catch-up / play today), or used
// (locked with no completed run). Assembled in ~3 reads for the whole strip, oldest → newest.
export type EditionCell = {
  date: string; isToday: boolean; played: boolean; available: boolean;
  runId: string | null; quizCorrect: number | null; quizTotal: number | null;
  status: string | null; stage: string | null; wdl: { w: number; d: number; l: number } | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function editionStrip(db: any, userId: string | null, current: string, past: string[]): Promise<EditionCell[]> {
  const dates = Array.from(new Set([current, ...past])).sort(); // oldest → newest (today last)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runByDate = new Map<string, any>();
  const wdlByRun = new Map<string, { w: number; d: number; l: number }>();
  const locked = new Set<string>();
  if (userId) {
    const { data: runs } = await db.from("draft_wc_runs")
      .select("id,run_date,status,stage,quiz_correct,quiz_total")
      .eq("user_id", userId).eq("ranked", true).in("run_date", dates);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const runIds = ((runs ?? []) as any[]).map((r) => r.id);
    if (runIds.length) {
      const { data: ms } = await db.from("draft_wc_matches").select("run_id,won,stage").in("run_id", runIds);
      for (const m of (ms ?? []) as { run_id: string; won: boolean | null; stage: string }[]) {
        if (m.stage === "playoff") continue; // play-off gate doesn't count to W-D-L (mirrors the run page)
        const c = wdlByRun.get(m.run_id) ?? { w: 0, d: 0, l: 0 };
        if (m.won === true) c.w++; else if (m.won === false) c.l++; else c.d++;
        wdlByRun.set(m.run_id, c);
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of (runs ?? []) as any[]) runByDate.set(r.run_date, r);
    const { data: locks } = await db.from("draft_wc_daily_locks").select("run_date").eq("user_id", userId).in("run_date", dates);
    for (const l of (locks ?? []) as { run_date: string }[]) locked.add(l.run_date);
  }
  return dates.map((date) => {
    const run = runByDate.get(date);
    const isLocked = locked.has(date) || !!run;
    return {
      date, isToday: date === current, played: !!run,
      // A guest (no account) has done none of them — surface every day as an open catch-up so
      // the strip entices sign-up; tapping routes into sign-in. Signed-in users get real state.
      available: userId ? !isLocked : true,
      runId: run?.id ?? null, quizCorrect: run?.quiz_correct ?? null, quizTotal: run?.quiz_total ?? null,
      status: run?.status ?? null, stage: run?.stage ?? null,
      wdl: run ? (wdlByRun.get(run.id) ?? { w: 0, d: 0, l: 0 }) : null,
    };
  });
}

export async function POST(req: NextRequest) {
  await ensurePool(); // slates draw from the player pool (spinWorld) — load it server-side first
  // Slates are date-seeded + server-secret-peppered (not user-specific) and the run isn't
  // created here, so the draft itself works pre-sign-in. But ranked is a logged-in
  // competition (the entry gates sign-in), so lock bookkeeping only runs when signed in.
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();

  const { ok } = await rateLimitDistributed(`draft-wc-draft:${user?.id ?? "anon"}`, 120, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: { action?: string; i?: number; answers?: unknown; picks?: unknown; catchup?: boolean; catchupDate?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const db = createWcDb();
  const catchup = body.catchup === true;
  const catchupDate = catchup && typeof body.catchupDate === "string" ? body.catchupDate : null;

  if (body.action === "status") {
    // Report the current run's state AND the open catch-up back-catalog for this user (each
    // past edition's `available` flag is false once they've played/locked that one).
    const current = await activeEdition(db);
    const prev = await previousEdition(db);
    const past = await pastEditions(db);
    const lockedToday = user ? await lockedFor(db, user.id, current) : false;
    const catchupAvailable = !!(user && prev && !(await lockedFor(db, user.id, prev)));
    const catchups = await Promise.all(past.map(async (edition) => ({
      edition,
      available: !!user && !(await lockedFor(db, user.id, edition)),
    })));
    // The full edition strip (today + past) for the WC tab — each cell carries this user's
    // played-state + stats so the strip can show catch-up vs an inline result peek per day.
    const editions = await editionStrip(db, user?.id ?? null, current, past);
    return NextResponse.json({ lockedToday, catchup: { edition: prev, available: catchupAvailable }, catchups, editions });
  }

  // begin/slate target the current edition, or whichever past edition catchupDate names.
  const date = await resolveEdition(db, catchup, catchupDate);
  if (!date) return NextResponse.json({ error: "That catch-up edition isn't available." }, { status: 400 });

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
