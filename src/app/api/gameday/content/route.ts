import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { getGamedayRow, cancelStaleFixture } from "@/lib/gameday/publish";
import { publishAtFor, validatePackQuestions } from "@/lib/gameday/shared";
import { normalizeQuestionText } from "@/lib/questions";

/**
 * POST /api/gameday/content — the single content-write route for the
 * Gameday pipeline. Dispatched on `op`, same shape as the retired
 * /api/halftime/fresh (one code path per side effect):
 *
 *   base     { fixtureId, questions[] }   persist the generated base slate;
 *                                         scheduled|base_ready → base_ready.
 *   approve  { fixtureId, questions[] }   the gate writes the APPROVED
 *                                         questions, pre-assigns pack_id,
 *                                         state → approved. This is the write
 *                                         that freezes content (§3.1) — nothing
 *                                         generates or mutates a pack's
 *                                         questions after this call.
 *   dedup    { texts[], excludeFixtureId? }  FIX P2-c: season-wide duplicate
 *                                         check (AC6). Returns the INDICES
 *                                         into `texts` that collide with the
 *                                         `questions` bank, any other gameday
 *                                         pack this season, or any Recap pack
 *                                         this season. Read-only.
 *   cancel   { fixtureId, reason? }       gate.mjs's deadline path (AC7): a
 *                                         pack unapproved by its publish_at,
 *                                         or a postponement gate.mjs learns
 *                                         about directly. Any pre-publish
 *                                         state → cancelled.
 *
 * CONTENT MUTATION IS IMPOSSIBLE AFTER APPROVAL: base/approve both refuse a
 * fixture already `approved` or `published`.
 *
 * Auth: Bearer CRON_SECRET (the VPS generation/gate scripts, HTTP only).
 */

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

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
      case "approve":
        return await opApprove(body);
      case "dedup":
        return await opDedup(body);
      case "cancel":
        return await opCancel(body);
      default:
        return NextResponse.json({ error: "op must be one of: base, approve, dedup, cancel" }, { status: 400 });
    }
  } catch (err) {
    console.error("[gameday/content] op failed", op, err);
    return NextResponse.json({ error: "op failed" }, { status: 500 });
  }
}

/** Persist the generated base slate. scheduled|base_ready → base_ready (CAS). */
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

  const row = await getGamedayRow(fixtureId);
  if (!row) return NextResponse.json({ error: "no such fixture" }, { status: 404 });
  if (row.state === "approved" || row.state === "published") {
    return NextResponse.json({ error: `content is frozen (state=${row.state})` }, { status: 409 });
  }
  if (row.state !== "scheduled" && row.state !== "base_ready") {
    return NextResponse.json({ error: `cannot write base slate in state ${row.state}` }, { status: 409 });
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
 * The gate: write the approved questions, pre-assign pack_id, freeze
 * publish_at (recomputed from the current kickoff_at so a kickoff moved
 * between sync and gate lands on the right day), base_ready → approved (CAS).
 */
async function opApprove(body: Record<string, unknown>) {
  const fixtureId = Number(body.fixtureId);
  if (!Number.isInteger(fixtureId)) {
    return NextResponse.json({ error: "fixtureId required" }, { status: 400 });
  }

  const questions = body.questions;
  const errs = validatePackQuestions(questions);
  if (errs.length) {
    return NextResponse.json({ error: "invalid pack", details: errs }, { status: 400 });
  }

  const row = await getGamedayRow(fixtureId);
  if (!row) return NextResponse.json({ error: "no such fixture" }, { status: 404 });
  if (row.state === "approved" || row.state === "published") {
    return NextResponse.json({ error: `already ${row.state}` }, { status: 409 });
  }
  if (row.state !== "base_ready") {
    return NextResponse.json({ error: `cannot approve in state ${row.state}` }, { status: 409 });
  }

  const packId = row.pack_id ?? crypto.randomUUID();
  const publishAt = publishAtFor(row.kickoff_at);

  const { data: won, error } = await db()
    .from("halftime_releases")
    .update({ state: "approved", pack_id: packId, questions, publish_at: publishAt })
    .eq("id", row.id)
    .eq("state", "base_ready")
    .select("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!won || won.length === 0) {
    return NextResponse.json({ error: "lost CAS race, not approved" }, { status: 409 });
  }

  return NextResponse.json({ ok: true, fixtureId, state: "approved", packId, publishAt });
}

/**
 * FIX P2-c: the season-wide duplicate check (AC6), server-side, using the
 * SAME normalization the bank's own uniqueness guard uses. Read-only —
 * writes nothing. Checked against three sources:
 *   (a) the `questions` bank, active rows only
 *   (b) every prior gameday pack THIS SEASON (base_ready or later — reverse
 *       fixtures recur and the H2H facts don't change, so a question already
 *       drafted for another fixture this season is still out even before
 *       it's approved)
 *   (c) every Recap pack this season (kind='recap')
 * excludeFixtureId lets a fixture regenerate its own slate without its own
 * prior draft counting as a collision against itself.
 *
 * Returns INDICES into `texts` (not the text itself) — gen-base.mjs's caller
 * (scripts/halftime/lib/api.mjs dedupCheck) filters candidates by position.
 */
async function opDedup(body: Record<string, unknown>) {
  const texts = Array.isArray(body.texts) ? body.texts.map((t) => String(t)) : null;
  if (!texts) return NextResponse.json({ error: "texts[] required" }, { status: 400 });
  if (!texts.length) return NextResponse.json({ collisions: [] });

  const excludeFixtureId =
    body.excludeFixtureId != null && Number.isInteger(Number(body.excludeFixtureId))
      ? Number(body.excludeFixtureId)
      : null;

  // Scope to the fixture's own season when we can derive one — narrower is
  // faster and still correct (reverse fixtures recur WITHIN a season; a
  // question from three seasons ago is not the collision risk this guards).
  // With no fixture context at all, fall back to season-unscoped: dedupe
  // wider rather than risk missing a real collision.
  let seasonId: number | null = null;
  if (excludeFixtureId != null) {
    const row = await getGamedayRow(excludeFixtureId);
    seasonId = row?.season_id ?? null;
  }

  const seen = new Set<string>();

  const { data: bankRows, error: bankErr } = await db()
    .from("questions")
    .select("question")
    .eq("status", "active");
  if (bankErr) return NextResponse.json({ error: bankErr.message }, { status: 500 });
  for (const r of (bankRows ?? []) as Array<{ question: string }>) {
    const t = normalizeQuestionText(r.question);
    if (t) seen.add(t);
  }

  let packsQuery = db()
    .from("halftime_releases")
    .select("fixture_id, season_id, base_questions, questions");
  if (seasonId != null) packsQuery = packsQuery.eq("season_id", seasonId);
  const { data: packRows, error: packErr } = await packsQuery;
  if (packErr) return NextResponse.json({ error: packErr.message }, { status: 500 });

  type PackRow = { fixture_id: number; base_questions: Array<{ question?: string }> | null; questions: Array<{ question?: string }> | null };
  for (const r of (packRows ?? []) as PackRow[]) {
    if (excludeFixtureId != null && Number(r.fixture_id) === excludeFixtureId) continue;
    for (const q of [...(r.questions ?? []), ...(r.base_questions ?? [])]) {
      const t = normalizeQuestionText(q?.question);
      if (t) seen.add(t);
    }
  }

  const collisions: number[] = [];
  texts.forEach((t, i) => {
    if (seen.has(normalizeQuestionText(t))) collisions.push(i);
  });

  return NextResponse.json({ collisions });
}

/**
 * gate.mjs's deadline path (AC7 / spec §3.3): a pack unapproved by its
 * publish_at, or a postponement gate.mjs learns about directly, is cancelled.
 * Reuses cancelStaleFixture (publish.ts) — the same function the publish cron
 * uses for the kickoff-already-passed case — so there is exactly one place
 * that decides which states may become cancelled (CAS: scheduled|base_ready|
 * approved|failed → cancelled; a no-op, not an error, on an already-terminal
 * row).
 */
async function opCancel(body: Record<string, unknown>) {
  const fixtureId = Number(body.fixtureId);
  if (!Number.isInteger(fixtureId)) {
    return NextResponse.json({ error: "fixtureId required" }, { status: 400 });
  }
  const reason = typeof body.reason === "string" && body.reason ? body.reason : "gate.mjs cancel";
  const result = await cancelStaleFixture(fixtureId, reason);
  return NextResponse.json({ ok: true, fixtureId, ...result });
}
