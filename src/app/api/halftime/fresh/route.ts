import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { getFixtureRow } from "@/lib/halftime/release";
import { normalizeQuestionText } from "@/lib/questions";
import {
  canTransition,
  isReleased,
  londonDayRange,
  validatePackQuestions,
  type FreshQuestion,
  type FreshState,
} from "@/lib/halftime/shared";

/**
 * POST /api/halftime/fresh — the single content-write route.
 *
 * Every content mutation in the pipeline funnels through here (one code path
 * per side effect), dispatched on `op`:
 *
 *   base    { fixtureId, questions[] }        persist the approved day-before
 *                                             slate; scheduled → base_ready.
 *   fresh   { fixtureId, questions[], state } persist the validated fresh slice
 *                                             + veto deadline + telegram msg id.
 *   veto    { fixtureId, index, status }      persist one founder tap. Written
 *                                             immediately, so a poller restart
 *                                             re-reads veto state from the DB
 *                                             and never from process memory.
 *   kill    { matchday }                      the slate kill switch: every
 *                                             not-yet-released fixture that day
 *                                             goes base-only.
 *   unkill  { matchday }                      only affects fixtures not yet
 *                                             assembled.
 *
 * CONTENT MUTATION IS IMPOSSIBLE AFTER RELEASE: every op refuses a released
 * fixture. Combined with the fact that all generation runs pre-kickoff, this is
 * what makes "no question can reference a first-half event" structural.
 *
 * Auth: Bearer CRON_SECRET.
 */

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const FRESH_STATES: FreshState[] = [
  "none", "pending_veto", "approved", "vetoed", "killed", "skipped",
];

function db(): SupabaseClient {
  return createServiceClient() as unknown as SupabaseClient;
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const op = String(body.op ?? "");

  try {
    switch (op) {
      case "base":
        return await opBase(body);
      case "fresh":
        return await opFresh(body);
      case "veto":
        return await opVeto(body);
      case "kickoff":
        return await opKickoff(body);
      case "kill":
        return await opKill(body, true);
      case "unkill":
        return await opKill(body, false);
      case "dedup":
        return await opDedup(body);
      default:
        return NextResponse.json(
          { error: "op must be one of: base, fresh, veto, kickoff, kill, unkill, dedup" },
          { status: 400 },
        );
    }
  } catch (err) {
    console.error("[halftime/fresh] op failed", op, err);
    return NextResponse.json({ error: "op failed" }, { status: 500 });
  }
}

/**
 * Season-wide duplicate check (AC6). Reverse fixtures recur — Arsenal v Spurs
 * happens twice a season and the H2H facts don't change — so a question that
 * already went out in ANY halftime pack this season, or that exists in the
 * active bank, must not be released again. The generators call this after
 * validation and drop the collisions.
 *
 * Normalization is the canonical normalizeQuestionText (src/lib/questions.ts),
 * the same one migration 67's unique index encodes — NOT the generators' local
 * approximation, which is exactly why the check lives server-side.
 */
async function opDedup(body: Record<string, unknown>) {
  const texts = body.texts;
  if (!Array.isArray(texts) || texts.length === 0 || texts.length > 100) {
    return NextResponse.json({ error: "texts must be a 1-100 item array" }, { status: 400 });
  }
  // The fixture being (re)generated is excluded, else regenerating a slate
  // collides with its own previous draft.
  const excludeFixtureId = Number.isInteger(Number(body.excludeFixtureId))
    ? Number(body.excludeFixtureId)
    : null;

  const seen = new Set<string>();

  // (a) The active question bank, paged — supabase caps a select at 1000 rows.
  const client = db();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from("questions")
      .select("question")
      .eq("status", "active")
      .range(from, from + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const r of data ?? []) seen.add(normalizeQuestionText((r as { question: string }).question));
    if (!data || data.length < 1000) break;
  }

  // (b) Every halftime question this season (season boundary: July 1st).
  const now = new Date();
  const seasonStart = new Date(Date.UTC(
    now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1, 6, 1,
  ));
  const { data: rows, error: hErr } = await client
    .from("halftime_releases")
    .select("fixture_id, base_questions, fresh_questions, pack_questions")
    .gte("kickoff_at", seasonStart.toISOString());
  if (hErr) return NextResponse.json({ error: hErr.message }, { status: 500 });
  for (const row of rows ?? []) {
    const r = row as {
      fixture_id: number;
      base_questions: unknown;
      fresh_questions: unknown;
      pack_questions: unknown;
    };
    if (excludeFixtureId !== null && r.fixture_id === excludeFixtureId) continue;
    for (const set of [r.base_questions, r.fresh_questions, r.pack_questions]) {
      if (!Array.isArray(set)) continue;
      for (const item of set) {
        const text = (item as { question?: unknown })?.question;
        if (typeof text === "string") seen.add(normalizeQuestionText(text));
      }
    }
  }

  const collisions: number[] = [];
  texts.forEach((t, i) => {
    if (typeof t === "string" && seen.has(normalizeQuestionText(t))) collisions.push(i);
  });
  return NextResponse.json({ collisions });
}

/** Persist the approved base slate. scheduled → base_ready (CAS). */
async function opBase(body: Record<string, unknown>) {
  const fixtureId = Number(body.fixtureId);
  if (!Number.isInteger(fixtureId)) {
    return NextResponse.json({ error: "fixtureId required" }, { status: 400 });
  }

  const questions = body.questions;
  const errs = validatePackQuestions(questions);
  if (errs.length) {
    return NextResponse.json({ error: "invalid base slate", details: errs }, { status: 400 });
  }

  const row = await getFixtureRow(fixtureId);
  if (!row) return NextResponse.json({ error: "no such fixture" }, { status: 404 });
  if (isReleased(row.state)) {
    return NextResponse.json({ error: "fixture already released" }, { status: 409 });
  }
  if (row.state !== "scheduled" && row.state !== "base_ready") {
    return NextResponse.json(
      { error: `cannot write base slate in state ${row.state}` },
      { status: 409 },
    );
  }
  if (row.state === "scheduled" && !canTransition("scheduled", "base_ready")) {
    return NextResponse.json({ error: "illegal transition" }, { status: 409 });
  }

  const { error } = await db()
    .from("halftime_releases")
    .update({ base_questions: questions, state: "base_ready" })
    .eq("id", row.id)
    .in("state", ["scheduled", "base_ready"]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, fixtureId, state: "base_ready" });
}

/**
 * Persist the validated fresh slice. Refuses to touch a fixture that is already
 * staged or released — the pack is frozen by then.
 */
async function opFresh(body: Record<string, unknown>) {
  const fixtureId = Number(body.fixtureId);
  if (!Number.isInteger(fixtureId)) {
    return NextResponse.json({ error: "fixtureId required" }, { status: 400 });
  }

  const questions = (body.questions ?? []) as FreshQuestion[];
  if (!Array.isArray(questions)) {
    return NextResponse.json({ error: "questions must be an array" }, { status: 400 });
  }
  if (questions.length > 3) {
    return NextResponse.json({ error: "fresh slice is capped at 3 questions" }, { status: 400 });
  }

  const freshState = String(body.state ?? "pending_veto") as FreshState;
  if (!FRESH_STATES.includes(freshState)) {
    return NextResponse.json({ error: `bad fresh state ${freshState}` }, { status: 400 });
  }

  const row = await getFixtureRow(fixtureId);
  if (!row) return NextResponse.json({ error: "no such fixture" }, { status: 404 });
  if (isReleased(row.state) || row.state === "staged") {
    return NextResponse.json(
      { error: `pack is frozen (state=${row.state})` },
      { status: 409 },
    );
  }

  // A killed matchday can never gain a fresh slice.
  const kill = await isKilled(row.kickoff_at);
  if (kill) {
    const { error } = await db()
      .from("halftime_releases")
      .update({ fresh_questions: [], fresh_state: "killed" })
      .eq("id", row.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, fixtureId, freshState: "killed", killed: true });
  }

  const patch: Record<string, unknown> = {
    fresh_questions: questions,
    fresh_state: freshState,
  };
  if (body.vetoDeadlineAt) patch.veto_deadline_at = String(body.vetoDeadlineAt);
  if (body.telegramMessageId) patch.telegram_message_id = Number(body.telegramMessageId);

  const { error } = await db().from("halftime_releases").update(patch).eq("id", row.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, fixtureId, freshState, count: questions.length });
}

/**
 * Persist one veto tap. Idempotent (writing the same status twice is a no-op).
 * Honoured right up to release-copy time; after release it is a no-op and the
 * caller is told so it can reply "too late".
 */
async function opVeto(body: Record<string, unknown>) {
  const fixtureId = Number(body.fixtureId);
  const index = Number(body.index);
  const status = String(body.status ?? "vetoed");

  if (!Number.isInteger(fixtureId)) {
    return NextResponse.json({ error: "fixtureId required" }, { status: 400 });
  }
  if (!["pending", "approved", "vetoed", "dropped"].includes(status)) {
    return NextResponse.json({ error: "bad status" }, { status: 400 });
  }

  const row = await getFixtureRow(fixtureId);
  if (!row) return NextResponse.json({ error: "no such fixture" }, { status: 404 });

  if (isReleased(row.state)) {
    return NextResponse.json({ ok: false, tooLate: true, state: row.state });
  }

  const fresh: FreshQuestion[] = row.fresh_questions ?? [];
  if (!fresh.length) {
    return NextResponse.json({ ok: false, reason: "no fresh slice" }, { status: 409 });
  }

  const all = body.all === true;
  if (!all && (!Number.isInteger(index) || index < 0 || index >= fresh.length)) {
    return NextResponse.json({ error: "index out of range" }, { status: 400 });
  }

  const updated = fresh.map((q, i) =>
    all || i === index ? ({ ...q, status } as FreshQuestion) : q,
  );

  const anyApproved = updated.some((q) => q.status === "approved" || q.status === "pending");
  const freshState: FreshState = anyApproved ? row.fresh_state : "vetoed";

  const { error } = await db()
    .from("halftime_releases")
    .update({ fresh_questions: updated, fresh_state: freshState })
    .eq("id", row.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    fixtureId,
    // A veto after the pack was staged still lands: release re-copies from
    // fresh_questions and pulls anything now marked vetoed.
    afterStaging: row.state === "staged",
    vetoed: updated.filter((q) => q.status === "vetoed").length,
  });
}

/**
 * Persist a kickoff move. SportMonks is the truth; the row follows it.
 *
 * WHY THIS EXISTS (added at integration — it was the gap between W2 and W1):
 * the poller followed a moved kickoff in its own run-state file, but nothing
 * wrote it back to the database. The watchdog reads `kickoff_at` straight from
 * the row. So a kickoff pushed back 30 minutes, plus a dead poller, meant the
 * watchdog believed the match had already started, saw a `base_ready` fixture
 * past its (stale) kickoff, and staged it BASE-ONLY — silently throwing away a
 * fresh slice that was still inside its veto window. Two independent clocks for
 * one fact is the bug; this route makes the row the single clock.
 *
 * Content is untouched here — only the time. Refused after release (the match
 * has happened; moving its kickoff is meaningless).
 */
async function opKickoff(body: Record<string, unknown>) {
  const fixtureId = Number(body.fixtureId);
  if (!Number.isInteger(fixtureId)) {
    return NextResponse.json({ error: "fixtureId required" }, { status: 400 });
  }

  const kickoffAt = String(body.kickoffAt ?? "");
  const when = new Date(kickoffAt);
  if (!kickoffAt || Number.isNaN(when.getTime())) {
    return NextResponse.json({ error: "kickoffAt must be an ISO timestamp" }, { status: 400 });
  }

  const row = await getFixtureRow(fixtureId);
  if (!row) return NextResponse.json({ error: "no such fixture" }, { status: 404 });
  if (isReleased(row.state)) {
    return NextResponse.json(
      { ok: false, tooLate: true, state: row.state },
      { status: 409 },
    );
  }

  const patch: Record<string, unknown> = { kickoff_at: when.toISOString() };
  // The veto deadline was derived from the old kickoff. The caller recomputes it
  // and hands it back, so the deadline the founder was promised and the deadline
  // the row enforces stay the same value.
  if (body.vetoDeadlineAt) patch.veto_deadline_at = String(body.vetoDeadlineAt);

  const { error } = await db()
    .from("halftime_releases")
    .update(patch)
    .eq("id", row.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    fixtureId,
    kickoffAt: when.toISOString(),
    previous: row.kickoff_at,
  });
}

/**
 * The slate kill switch. One message kills a whole matchday's fresh slices:
 * every not-yet-released fixture goes base-only, INCLUDING ones already staged
 * with fresh questions in them — those get re-assembled base-only by the poller
 * (their fresh_state flips to 'killed', which questionsForRelease() honours).
 * Already-released packs are untouched.
 */
async function opKill(body: Record<string, unknown>, kill: boolean) {
  const matchday = String(body.matchday ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(matchday)) {
    return NextResponse.json({ error: "matchday must be YYYY-MM-DD" }, { status: 400 });
  }

  const raw = db();
  const { error: ctlErr } = await raw
    .from("halftime_control")
    .upsert({ matchday, fresh_kill: kill, updated_at: new Date().toISOString() }, { onConflict: "matchday" });

  if (ctlErr) return NextResponse.json({ error: ctlErr.message }, { status: 500 });

  if (!kill) {
    // UNKILL only affects fixtures that have not been assembled yet — a pack
    // already staged base-only stays base-only.
    return NextResponse.json({ ok: true, matchday, freshKill: false, affected: [] });
  }

  const { startUtc, endUtc } = londonDayRange(matchday);
  const { data: affected, error } = await raw
    .from("halftime_releases")
    .update({ fresh_state: "killed" })
    .gte("kickoff_at", startUtc)
    .lt("kickoff_at", endUtc)
    .in("state", ["scheduled", "base_ready", "staged"])
    .select("fixture_id, home, away, state");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    matchday,
    freshKill: true,
    affected: affected ?? [],
  });
}

/** Is the kill switch set for the Europe/London day this kickoff falls on? */
async function isKilled(kickoffAt: string): Promise<boolean> {
  const matchday = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(kickoffAt));

  const { data } = await db()
    .from("halftime_control")
    .select("fresh_kill")
    .eq("matchday", matchday)
    .maybeSingle();

  return Boolean((data as { fresh_kill?: boolean } | null)?.fresh_kill);
}
