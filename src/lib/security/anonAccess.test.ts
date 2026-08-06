import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Security regression probes (Trust sprint 1) — read-only checks that the
 * PUBLIC anon key genuinely cannot read what should be locked behind RLS or
 * column-level grants. Hits the live Supabase REST endpoint directly with
 * ONLY `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — the
 * exact credentials a signed-out browser tab has. GET requests only; this
 * file must never write.
 *
 * Skips cleanly (not fails) when those env vars aren't set, so CI stays
 * green with no secrets configured — see the `skip` guard on every test.
 *
 * VERIFIED STATE (run once against production, 6 Aug 2026): the
 * `questions.answer`, `quiz_packs.questions`, `quiz_attempts.answers`, and
 * `h2h_challenges.challenger_answers`/`opponent_answers` probes ALL FAIL
 * today — those columns are still readable with just the anon key (matches
 * the Jul 30 security audit's "3,211 quiz answers dumpable" finding). They
 * are expected to start passing once the migration that revokes that access
 * ships; from that point on, this file is the regression guard that catches
 * a re-exposure. The `comments` (both subject_type = fantasy_feed AND
 * fantasy_league) and `rooms.questions_json` probes already PASS today —
 * fantasy_league is the control that proves this methodology finds a real
 * block when there is one, rather than always reporting "safe" by accident.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const READY = !!SUPABASE_URL && !!ANON_KEY;

interface RestResult { ok: boolean; status: number; body: unknown }

/** A single read-only PostgREST GET, authenticated as the anon key only —
 *  never a service key, never a write verb. */
async function restGet(query: string): Promise<RestResult> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${query}`, {
    method: "GET",
    headers: { apikey: ANON_KEY as string, Authorization: `Bearer ${ANON_KEY}` },
  });
  let body: unknown = null;
  try { body = await res.json(); } catch { /* non-JSON error body — fine, status still tells the story */ }
  return { ok: res.ok, status: res.status, body };
}

/** True when `column` is genuinely absent from every row PostgREST handed
 *  back — covers both ways "not exposed" can show up: an outright error
 *  response (column privilege revoked, or the whole table blocked for anon)
 *  and a 200 whose rows simply don't carry the key (RLS filtered every row
 *  out before the column list was even applied). */
function columnAbsent(r: RestResult, column: string): boolean {
  if (!r.ok) return true;
  const rows = Array.isArray(r.body) ? r.body : [];
  if (rows.length === 0) return true;
  return rows.every((row) => typeof row === "object" && row !== null && !(column in (row as Record<string, unknown>)));
}

/** True when a row set is simply not readable by anon — an error response,
 *  or a 200 with zero rows (RLS quietly filtered everything out). */
function rowsBlocked(r: RestResult): boolean {
  if (!r.ok) return true;
  return Array.isArray(r.body) && r.body.length === 0;
}

test("questions: `answer` column is not exposed to anon (select=answer)", { skip: !READY }, async () => {
  const r = await restGet("questions?select=answer&limit=5");
  assert.ok(columnAbsent(r, "answer"), `anon can read questions.answer: ${JSON.stringify(r.body).slice(0, 300)}`);
});

test("questions: select=* does not leak an `answer` field", { skip: !READY }, async () => {
  const r = await restGet("questions?select=*&limit=5");
  assert.ok(columnAbsent(r, "answer"), `select=* on questions leaks answer: ${JSON.stringify(r.body).slice(0, 300)}`);
});

test("quiz_packs: `questions` column is not exposed to anon", { skip: !READY }, async () => {
  const r = await restGet("quiz_packs?select=questions&limit=5");
  assert.ok(columnAbsent(r, "questions"), `anon can read quiz_packs.questions: ${JSON.stringify(r.body).slice(0, 300)}`);
});

test("quiz_attempts: `answers` column is not exposed to anon", { skip: !READY }, async () => {
  const r = await restGet("quiz_attempts?select=answers&limit=5");
  assert.ok(columnAbsent(r, "answers"), `anon can read quiz_attempts.answers: ${JSON.stringify(r.body).slice(0, 300)}`);
});

test("h2h_challenges: `challenger_answers`/`opponent_answers` are not exposed to anon", { skip: !READY }, async () => {
  const r = await restGet("h2h_challenges?select=challenger_answers,opponent_answers&limit=5");
  assert.ok(columnAbsent(r, "challenger_answers"), `anon can read h2h_challenges.challenger_answers: ${JSON.stringify(r.body).slice(0, 300)}`);
  assert.ok(columnAbsent(r, "opponent_answers"), `anon can read h2h_challenges.opponent_answers: ${JSON.stringify(r.body).slice(0, 300)}`);
});

test("comments: subject_type=fantasy_feed rows are not readable by anon", { skip: !READY }, async () => {
  const r = await restGet("comments?select=id&subject_type=eq.fantasy_feed&limit=5");
  assert.ok(rowsBlocked(r), `anon can read fantasy_feed comments: ${JSON.stringify(r.body).slice(0, 300)}`);
});

test("comments: subject_type=fantasy_league rows are not readable by anon (control)", { skip: !READY }, async () => {
  const r = await restGet("comments?select=id&subject_type=eq.fantasy_league&limit=5");
  assert.ok(rowsBlocked(r), `control failed — anon can read fantasy_league comments too: ${JSON.stringify(r.body).slice(0, 300)}`);
});

const ANSWERISH_KEYS = ["answer", "correct", "answerId", "correct_index"];

test("rooms.questions_json entries carry no answer-ish key (regression guard)", { skip: !READY }, async () => {
  const r = await restGet("rooms?select=questions_json&limit=20");
  const rows = (Array.isArray(r.body) ? r.body : []) as { questions_json?: unknown }[];
  for (const row of rows) {
    const list = Array.isArray(row.questions_json) ? row.questions_json : [];
    for (const q of list) {
      if (!q || typeof q !== "object") continue;
      for (const key of ANSWERISH_KEYS) {
        assert.ok(!(key in (q as Record<string, unknown>)), `rooms.questions_json entry carries "${key}": ${JSON.stringify(q).slice(0, 200)}`);
      }
    }
  }
});
