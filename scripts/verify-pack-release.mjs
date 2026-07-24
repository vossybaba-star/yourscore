/**
 * Verifies the quiz-pack draft → approve → release state machine end to end.
 *
 *   node --env-file=.env.local scripts/verify-pack-release.mjs
 *
 * Runs against the real DB (that is the point — the guards ARE the WHERE clauses, so
 * testing them in isolation proves nothing). It creates ONE clearly-named test pack and
 * deletes it again in a `finally`, whatever happens, then asserts no test rows survive.
 *
 * It NEVER sends a push or an email. It exercises the DB state machine only, so it is safe
 * to re-run at any time — including against prod.
 *
 * What it proves:
 *   1. a draft pack is invisible to players
 *   2. a DUE but UNAPPROVED pack is never picked up  (approve nothing → ship nothing)
 *   3. an approved + due pack IS picked up
 *   4. releasing flips it live and visible
 *   5. re-running the release is a no-op   (idempotency — no double-release, no double-push)
 *   6. an unapproved pack can never be flipped, even with a past release_at
 */

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (source .env.local)");
  process.exit(1);
}
const db = createClient(url, key);

const NAME = "ZZZ TEST PACK — DELETE ME (quiz-factory verification)";
let failures = 0;
const ok = (cond, msg) => {
  if (!cond) failures++;
  console.log(`${cond ? "✓" : "✗ FAIL"}  ${msg}`);
};
let packId = null;

const q = (i) => ({
  question: `Test question ${i}?`,
  options: { A: "Alpha", B: "Bravo", C: "Charlie", D: "Delta" },
  answer: "B",
  difficulty: i <= 4 ? "easy" : i <= 11 ? "medium" : i <= 14 ? "hard" : "expert",
  verification_note: JSON.stringify({ checked_on: "2026-07-14", source_url: "https://example.test", confidence: "high" }),
});

/** The exact filter /api/quiz/packs uses to decide what a player can see. */
const visibleToPlayers = async () => {
  const { data } = await db
    .from("quiz_packs").select("id")
    .eq("status", "published").eq("rotation_active", true).eq("name", NAME);
  return (data ?? []).length > 0;
};

/** The exact query scripts/release-packs.mjs uses to find what's due. */
const dueQuery = () =>
  db.from("quiz_packs").select("id")
    .eq("status", "draft")
    .not("approved_at", "is", null)
    .lte("release_at", new Date().toISOString());

/** The exact UPDATE scripts/release-packs.mjs uses. Its WHERE clause is the whole guard. */
const flip = () =>
  db.from("quiz_packs")
    .update({ status: "published", rotation_active: true, featured: true })
    .eq("id", packId)
    .eq("status", "draft")            // ← only a still-draft row flips (idempotency)
    .not("approved_at", "is", null)   // ← never publish an unapproved pack
    .select("id").maybeSingle();

try {
  await db.from("quiz_packs").delete().eq("name", NAME); // clean slate

  const { data: ins, error: insErr } = await db.from("quiz_packs").insert({
    type: "records", name: NAME, theme: "Verification", parameter: "Verification",
    questions: Array.from({ length: 15 }, (_, i) => q(i + 1)),
    status: "draft", source: "system", rotation_active: false, featured: false,
    approved_at: null,
    release_at: new Date(Date.now() - 3600_000).toISOString(), // due an hour ago
    metadata: { themed: true, test: true },
  }).select("id").single();
  if (insErr) throw new Error(`insert failed: ${insErr.message}`);
  packId = ins.id;
  console.log(`\ncreated draft ${packId}\n`);

  ok(!(await visibleToPlayers()), "a draft pack is INVISIBLE to players");

  const { data: dueUnapproved } = await dueQuery();
  ok(!(dueUnapproved ?? []).some((p) => p.id === packId),
     "a DUE but UNAPPROVED pack is NOT picked up — approve nothing, ship nothing");

  await db.from("quiz_packs").update({ approved_at: new Date().toISOString() }).eq("id", packId);
  const { data: dueApproved } = await dueQuery();
  ok((dueApproved ?? []).some((p) => p.id === packId), "once approved AND due, it IS picked up");

  const { data: first } = await flip();
  ok(!!first, "release flips the pack live");
  ok(await visibleToPlayers(), "the released pack is now VISIBLE to players");

  const { data: second } = await flip();
  ok(!second, "re-running the release is a NO-OP — no double-release, no double-push");

  await db.from("quiz_packs")
    .update({ status: "draft", rotation_active: false, approved_at: null }).eq("id", packId);
  const { data: third } = await flip();
  ok(!third, "an UNAPPROVED pack can NEVER be released, even with a past release_at");

} catch (e) {
  failures++;
  console.error(`\n✗ ERROR: ${e.message}`);
} finally {
  if (packId) {
    const { error } = await db.from("quiz_packs").delete().eq("id", packId);
    console.log(`\n${error ? `✗ CLEANUP FAILED — delete pack ${packId} by hand!` : `🧹 deleted test pack ${packId}`}`);
    if (error) failures++;
  }
  const { data: leftover } = await db.from("quiz_packs").select("id").eq("name", NAME);
  if (leftover?.length) { failures++; console.log(`✗ LEFTOVER TEST ROWS IN DB: ${leftover.length}`); }
  else console.log("✓ no test rows left behind");

  console.log(failures ? `\n✗ ${failures} FAILURE(S)\n` : `\n✓ all checks passed\n`);
  process.exit(failures ? 1 : 0);
}
