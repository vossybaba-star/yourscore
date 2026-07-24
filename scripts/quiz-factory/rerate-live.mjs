/**
 * Re-rate the LIVE bank with the new difficulty model, and find out what's actually usable.
 *
 *   node --env-file=.env.local scripts/quiz-factory/rerate-live.mjs                 # REPORT (no writes)
 *   node --env-file=.env.local scripts/quiz-factory/rerate-live.mjs --commit        # write new difficulties
 *   node --env-file=.env.local scripts/quiz-factory/rerate-live.mjs --limit 300     # sample first
 *
 * Why: 1,205 questions are tagged expert/master and are therefore unreachable — the draw is
 * typed "easy"|"medium"|"hard" and can never ask for them. I previously wrote them off as
 * "all hard, not worth recovering" — but that judgement came from the OLD self-declared
 * difficulty, which is exactly the signal we agreed is unreliable and drifts. So this re-rates
 * them properly: a separate rater, against the fixed anchors, seeing only the question.
 *
 * Cheap: the rater is batched and does no web search (~$0.01 per 30 questions).
 *
 * It does NOT fact-check — a re-rated question is correctly LEVELLED, not verified. The
 * Haaland-2010 fabrication would sail through this. Verification is a separate, costlier pass
 * and is worth spending only on the questions we actually need (the easy ones).
 */

import { createClient } from "@supabase/supabase-js";
import { rateBatch } from "./difficulty.mjs";
import { checkTemporal, checkSpecificity, checkShape } from "./verify.mjs";
import { costReport, usage, CreditExhausted } from "../lib/anthropic.mjs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Missing Supabase env (source .env.local)"); process.exit(1); }
const db = createClient(url, key);

const arg = (f, d) => { const i = process.argv.indexOf(f); return i !== -1 ? process.argv[i + 1] : d; };
const COMMIT = process.argv.includes("--commit");
const LIMIT = Number(arg("--limit", 0));
const BATCH = 25;

async function fetchAll() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("questions")
      .select("id, entity, entity_type, category, difficulty, question, options, answer")
      .eq("status", "active")
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) { console.error(error.message); process.exit(1); }
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
    if (LIMIT && rows.length >= LIMIT) break;
  }
  return LIMIT ? rows.slice(0, LIMIT) : rows;
}

const all = await fetchAll();

// Skip anything the free gates already reject — no point rating a question we're retiring.
const gated = [];
const rejected = [];
for (const r of all) {
  const q = { question: r.question, options: r.options, answer: r.answer, difficulty: "medium" };
  if (!checkShape(q).ok || !checkTemporal(r.question).ok || !checkSpecificity(r.question).ok) {
    rejected.push(r);
    continue;
  }
  gated.push(r);
}

console.log(`\n═══ RE-RATING THE LIVE BANK ═══${COMMIT ? "" : "   (REPORT ONLY — no writes)"}\n`);
console.log(`Active:              ${all.length}`);
console.log(`Fails the free gates: ${rejected.length}  (not rated — these are the retire list)`);
console.log(`To re-rate:          ${gated.length}\n`);

const rated = [];
try {
  for (let i = 0; i < gated.length; i += BATCH) {
    const chunk = gated.slice(i, i + BATCH);
    process.stdout.write(`\r   rating ${Math.min(i + BATCH, gated.length)}/${gated.length}…   `);
    const { rated: out } = await rateBatch(
      chunk.map((r) => ({ question: r.question, options: r.options, answer: r.answer }))
    );
    out.forEach((o, j) => rated.push({ ...chunk[j], newDifficulty: o.difficulty, adjusted: o._difficultyAdjusted }));
  }
} catch (e) {
  if (e instanceof CreditExhausted) { console.error(`\n${e.message}`); process.exit(2); }
  throw e;
}
process.stdout.write("\r".padEnd(40) + "\r");

// ── The question that matters: what were the "unreachable" ones really? ──────
const wasUnreachable = rated.filter((r) => ["expert", "master"].includes(r.difficulty));
const wasServed = rated.filter((r) => ["easy", "medium", "hard"].includes(r.difficulty));

const tally = (rows) => rows.reduce((a, r) => ({ ...a, [r.newDifficulty]: (a[r.newDifficulty] ?? 0) + 1 }), {});

console.log(`── The 1,205 "unreachable" (expert/master) — re-rated properly:\n`);
const uTally = tally(wasUnreachable);
for (const lvl of ["easy", "medium", "hard"]) {
  const n = uTally[lvl] ?? 0;
  const pctv = wasUnreachable.length ? Math.round((n / wasUnreachable.length) * 100) : 0;
  console.log(`   ${lvl.padEnd(7)} ${String(n).padStart(5)}  (${String(pctv).padStart(3)}%)  ${"█".repeat(Math.round(pctv / 3))}`);
}
const recovered = (uTally.easy ?? 0) + (uTally.medium ?? 0);
console.log(`\n   → ${recovered} of ${wasUnreachable.length} are NOT hard. They were mis-labelled and are recoverable.`);
console.log(`   → ${uTally.easy ?? 0} of them are EASY — the exact thing the bank is short of.\n`);

console.log(`── The ${wasServed.length} already-reachable ones — re-rated:\n`);
const sTally = tally(wasServed);
for (const lvl of ["easy", "medium", "hard"]) {
  console.log(`   ${lvl.padEnd(7)} ${String(sTally[lvl] ?? 0).padStart(5)}`);
}
const moved = wasServed.filter((r) => r.difficulty !== r.newDifficulty).length;
console.log(`\n   → ${moved} would change level (the old self-declared rating was wrong).\n`);

// Whole-bank picture after re-rating.
const total = tally(rated);
const easyPct = Math.round(((total.easy ?? 0) / rated.length) * 100);
console.log(`── Whole bank after re-rating: ${JSON.stringify(total)}  (${easyPct}% easy, was 5%)\n`);

console.log(`Cost:\n${costReport()}\n`);

if (!COMMIT) {
  console.log(`REPORT ONLY — nothing written. Re-run with --commit to apply the new difficulties.\n`);
  process.exit(0);
}

// ── Write ────────────────────────────────────────────────────────────────────
//
// CAREFUL. Writing the new rating for every changed row is WRONG, and dangerously so: an
// expert/master row re-rated to "hard" would become REACHABLE — promoting ~1,061 questions
// that have never been fact-checked into the draw. The Haaland-2010 fabrication is tagged
// `expert`; a blanket write would take a known-false, currently-invisible question and start
// serving it. Founder's decision (2026-07-16) is to LEAVE those stranded.
//
// So there are exactly two cases where we write:
//   1. The row is already reachable (easy/medium/hard) → its rating was self-declared and is
//      wrong ~36% of the time. Fix it. Reachability doesn't change.
//   2. The row is stranded (expert/master) but re-rates to easy/medium → recover it, because
//      easy/medium is what the bank is short of. This is the only promotion we allow.
//
// A stranded row re-rating to "hard" is SKIPPED: it stays stranded. We're oversupplied on
// hard, and it's unverified.
const RECOVERABLE = ["easy", "medium"];
const isReachable = (d) => ["easy", "medium", "hard"].includes(d);

let nFixed = 0, nRecovered = 0, nLeftStranded = 0;
for (const r of rated) {
  const wasReachable = isReachable(r.difficulty);

  if (!wasReachable && !RECOVERABLE.includes(r.newDifficulty)) {
    nLeftStranded++;         // stranded → still hard ⇒ leave it exactly as it is
    continue;
  }
  if (r.difficulty === r.newDifficulty) continue;

  const { error } = await db.from("questions").update({ difficulty: r.newDifficulty }).eq("id", r.id);
  if (error) { console.error(`   ✗ ${r.id}: ${error.message}`); continue; }
  if (wasReachable) nFixed++; else nRecovered++;
}

console.log(`✓ fixed ${nFixed} wrong difficulties on already-served questions`);
console.log(`✓ recovered ${nRecovered} stranded questions that are actually easy/medium`);
console.log(`· left ${nLeftStranded} stranded questions alone (genuinely hard, unverified — founder's call)`);
console.log(`\n$${usage.usd.toFixed(2)} spent\n`);
