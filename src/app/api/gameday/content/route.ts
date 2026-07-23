import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { getGamedayRow } from "@/lib/gameday/publish";
import { publishAtFor, validatePackQuestions } from "@/lib/gameday/shared";

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
 *
 * CONTENT MUTATION IS IMPOSSIBLE AFTER APPROVAL: both ops refuse a fixture
 * already `approved` or `published`.
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
      default:
        return NextResponse.json({ error: "op must be one of: base, approve" }, { status: 400 });
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
