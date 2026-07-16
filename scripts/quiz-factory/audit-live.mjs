/**
 * Run the NEW gates over the questions that are ALREADY LIVE. Read-only. Zero API cost —
 * every check here is deterministic.
 *
 *   node --env-file=.env.local scripts/quiz-factory/audit-live.mjs
 *   node --env-file=.env.local scripts/quiz-factory/audit-live.mjs --show 12   # print examples
 *
 * The live bank predates all of this: no temporal rule, no specificity rule, no independent
 * verification, and difficulty self-declared by the author. It also contains at least one
 * outright fabrication (found by sampling: "How many PL goals did Haaland score for Man City
 * in 2010-11?" — he was ten). This measures how much of the bank the current gates would
 * reject, so the decision about what to do with it is made on numbers rather than vibes.
 *
 * It does NOT fact-check (that costs money) — this is only the free tier. A question passing
 * here is not verified, it merely isn't obviously broken.
 */

import { createClient } from "@supabase/supabase-js";
import { checkTemporal, checkSpecificity, checkShape } from "./verify.mjs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Missing Supabase env (source .env.local)"); process.exit(1); }
const db = createClient(url, key);

const showIdx = process.argv.indexOf("--show");
const SHOW = showIdx !== -1 ? Number(process.argv[showIdx + 1]) : 4;

// The draw (`/api/quiz/start`) is typed "easy" | "medium" | "hard" and asks for 6/6/3.
// Anything tagged expert/master can never be requested, so it is unreachable inventory.
const SERVED = ["easy", "medium", "hard"];

async function fetchAll() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("questions")
      .select("id, entity, entity_type, category, difficulty, question, options, answer, source, times_answered, times_correct")
      .eq("status", "active")
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) { console.error(error.message); process.exit(1); }
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

const rows = await fetchAll();
const served = rows.filter((r) => SERVED.includes(r.difficulty));
const stranded = rows.filter((r) => !SERVED.includes(r.difficulty));

console.log(`\n═══ LIVE BANK vs THE CURRENT GATES ═══  (read-only, no API cost)\n`);
console.log(`Active questions:    ${rows.length}`);
console.log(`  reachable:         ${served.length}   (easy/medium/hard — the only levels the draw asks for)`);
console.log(`  UNREACHABLE:       ${stranded.length}   (expert/master — can never be served)\n`);

const fails = { temporal: [], specificity: [], shape: [] };

for (const r of served) {
  const q = { question: r.question, options: r.options, answer: r.answer, difficulty: r.difficulty };
  const shape = checkShape(q);
  if (!shape.ok) { fails.shape.push({ r, reason: shape.reason }); continue; }
  const temporal = checkTemporal(r.question);
  if (!temporal.ok) { fails.temporal.push({ r, reason: temporal.reason }); continue; }
  const spec = checkSpecificity(r.question);
  if (!spec.ok) { fails.specificity.push({ r, reason: spec.reason }); continue; }
}

const totalFail = fails.temporal.length + fails.specificity.length + fails.shape.length;
const pct = (n) => `${Math.round((n / served.length) * 100)}%`;

console.log(`Of the ${served.length} REACHABLE questions, the current gates would reject:\n`);
console.log(`  temporal     ${String(fails.temporal.length).padStart(4)}  (${pct(fails.temporal.length).padStart(3)})  answer depends on when it's read`);
console.log(`  specificity  ${String(fails.specificity.length).padStart(4)}  (${pct(fails.specificity.length).padStart(3)})  scope-ambiguous — league or Europe?`);
console.log(`  shape        ${String(fails.shape.length).padStart(4)}  (${pct(fails.shape.length).padStart(3)})  bad options (dupes, hedges, mixed types)`);
console.log(`  ─────────────────────`);
console.log(`  TOTAL        ${String(totalFail).padStart(4)}  (${pct(totalFail).padStart(3)})  would not be written today\n`);

for (const [kind, list] of Object.entries(fails)) {
  if (!list.length) continue;
  console.log(`\n── ${kind} — ${list.length} failures, first ${Math.min(SHOW, list.length)}:`);
  for (const { r, reason } of list.slice(0, SHOW)) {
    console.log(`   [${r.difficulty}] ${r.entity}: ${r.question}`);
    console.log(`      → ${r.options?.[r.answer]}`);
    console.log(`      ✗ ${reason}`);
  }
}

// ── The quality alarm (founder's rule: live answers flag bad questions, never set difficulty) ──
const answered = served.filter((r) => (r.times_answered ?? 0) >= 10);
const suspect = answered
  .filter((r) => (r.times_correct ?? 0) / r.times_answered < 0.1)
  .sort((a, b) => b.times_answered - a.times_answered);

console.log(`\n\n── QUALITY ALARM — questions real players almost never get right`);
console.log(`   (${answered.length} questions have 10+ attempts; ${suspect.length} are under 10% correct)`);
console.log(`   A near-zero correct rate usually means the question is WRONG, not hard.\n`);
for (const r of suspect.slice(0, SHOW)) {
  console.log(`   ${r.times_correct}/${r.times_answered} correct — [${r.difficulty}] ${r.entity}: ${r.question}`);
  console.log(`      claimed answer → ${r.options?.[r.answer]}`);
}
if (!suspect.length) console.log(`   (none — but note only ${answered.length} questions have meaningful volume)`);

console.log(`\n\nNOTE: this is the FREE tier only — deterministic checks. Passing here means a question`);
console.log(`isn't obviously broken; it does NOT mean the fact is true. The Haaland-2010 fabrication`);
console.log(`passes every check above, because it's well-formed, specific and past-tense. Only`);
console.log(`fact-checking against SportMonks/the web catches that class — and that costs money.\n`);
