/**
 * Clean the live bank. Two passes, both founder-approved (2026-07-16):
 *
 *   1. RETIRE the questions that fail the deterministic gates — they rot ("Reading's MOST
 *      RECENT PL season", "who IS the all-time CL scorer"). Free, no API.
 *   2. VERIFY the survivors against the cached SportMonks fact sheets — no web search, so
 *      ~$0.01 each. This is the cohort that produced the Haaland-2010 fabrication ("How many
 *      PL goals did Haaland score for Man City in 2010-11?" — he was ten), so it has never
 *      been fact-checked at all.
 *
 *   node --env-file=.env.local scripts/quiz-factory/clean-live.mjs                 # REPORT
 *   node --env-file=.env.local scripts/quiz-factory/clean-live.mjs --retire --commit
 *   node --env-file=.env.local scripts/quiz-factory/clean-live.mjs --verify --commit
 *   node --env-file=.env.local scripts/quiz-factory/clean-live.mjs --verify --entity Arsenal
 *
 * A question SportMonks can't judge is NOT retired — it's left alone and reported. Absence of
 * evidence isn't evidence of a fabrication, and the fact sheets only cover PL + European
 * league data. Only a question SportMonks actively CONTRADICTS gets retired.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { checkTemporal, checkSpecificity, checkShape, verifyAgainstFacts } from "./verify.mjs";
import { clubFactSheet, factSheetText, canonicalClub } from "../lib/sportmonks.mjs";
import { costReport, CreditExhausted } from "../lib/anthropic.mjs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Missing Supabase env (source .env.local)"); process.exit(1); }
const db = createClient(url, key);

const arg = (f, d) => { const i = process.argv.indexOf(f); return i !== -1 ? process.argv[i + 1] : d; };
const COMMIT = process.argv.includes("--commit");
const RETIRE = process.argv.includes("--retire");
const VERIFY = process.argv.includes("--verify");
const ONLY_ENTITY = arg("--entity", null);
const LIMIT = Number(arg("--limit", 0));

async function fetchActive() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    let q = db.from("questions")
      .select("id, entity, entity_type, category, difficulty, question, options, answer")
      .eq("status", "active")
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (ONLY_ENTITY) q = q.eq("entity", ONLY_ENTITY);
    const { data, error } = await q;
    if (error) { console.error(error.message); process.exit(1); }
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return LIMIT ? rows.slice(0, LIMIT) : rows;
}

const all = await fetchActive();
console.log(`\n═══ CLEAN LIVE BANK ═══${COMMIT ? "" : "   (REPORT ONLY)"}\n`);
console.log(`Active questions: ${all.length}${ONLY_ENTITY ? ` (entity=${ONLY_ENTITY})` : ""}\n`);

// ── PASS 1: retire the rotting ───────────────────────────────────────────────
const rotting = [];
const survivors = [];
for (const r of all) {
  const q = { question: r.question, options: r.options, answer: r.answer, difficulty: "medium" };
  const shape = checkShape(q);
  const temporal = checkTemporal(r.question);
  const spec = checkSpecificity(r.question);
  const bad = !shape.ok ? shape.reason : !temporal.ok ? temporal.reason : !spec.ok ? spec.reason : null;
  if (bad) rotting.push({ ...r, reason: bad });
  else survivors.push(r);
}

console.log(`PASS 1 — deterministic gates (free):`);
console.log(`   ${rotting.length} rotting  ·  ${survivors.length} survive\n`);

if (RETIRE) {
  if (!COMMIT) {
    console.log(`   would retire ${rotting.length}. First 3:`);
    for (const r of rotting.slice(0, 3)) console.log(`     [${r.difficulty}] ${r.entity}: ${r.question}\n        ✗ ${r.reason}`);
  } else {
    let done = 0;
    for (let i = 0; i < rotting.length; i += 100) {
      const ids = rotting.slice(i, i + 100).map((r) => r.id);
      const { error } = await db
        .from("questions")
        // status='retired' (not delete) — the row is evidence of what the old regime produced,
        // and questions are referenced by user_question_history.
        .update({ status: "retired", verification_note: JSON.stringify({ retired_on: new Date().toISOString().slice(0, 10), reason: "fails temporal/specificity/shape gates" }) })
        .in("id", ids);
      if (error) console.error(`   ✗ ${error.message}`);
      else done += ids.length;
    }
    console.log(`   ✓ retired ${done}\n`);
  }
}

// ── PASS 2: SportMonks verification sweep ────────────────────────────────────
if (!VERIFY) {
  console.log(`(add --verify for the SportMonks sweep, --retire to retire the rotting ones)\n`);
  process.exit(0);
}

// Only club questions can be checked against a club fact sheet — AND only REACHABLE ones.
// Verifying expert/master rows would be money spent on questions the draw can never ask for
// (founder's call: leave them stranded). They're invisible; leave them invisible.
const SERVED = ["easy", "medium", "hard"];
const clubRows = survivors.filter((r) => r.entity_type === "club" && SERVED.includes(r.difficulty));
const entities = [...new Set(clubRows.map((r) => r.entity))];
console.log(`PASS 2 — SportMonks sweep over ${clubRows.length} club questions across ${entities.length} clubs`);
console.log(`   (no web search — a question SportMonks can't judge is LEFT ALONE, not retired)\n`);

const contradicted = [];
const confirmed = [];
const uncovered = [];

// Checkpointed. This sweep is ~1,300 sequential API calls over ~45 minutes, and the first
// attempt died 60% through on a single DNS blip (ENOTFOUND api.anthropic.com), losing the lot.
// Progress is now written to disk per club and reloaded on restart, and a transient failure
// on ONE question no longer kills the run.
const CKPT = join(process.cwd(), "scripts/data/sportmonks-cache/sweep-checkpoint.json");
let done = {};
if (existsSync(CKPT)) {
  done = JSON.parse(readFileSync(CKPT, "utf8"));
  const already = Object.values(done).reduce((a, e) => a + e.confirmed.length + e.contradicted.length + e.uncovered.length, 0);
  if (already) console.log(`   ↻ resuming — ${already} questions already checked in a previous run\n`);
}
const saveCkpt = () => writeFileSync(CKPT, JSON.stringify(done));

try {
  for (const entity of entities) {
    if (done[entity]) continue; // already swept in a previous run
    const rows = clubRows.filter((r) => r.entity === entity);
    const e = { confirmed: [], contradicted: [], uncovered: [] };

    let sheet;
    try {
      const fs = await clubFactSheet(entity, { fromYear: 2000 });
      if (!fs.seasons.length) { e.uncovered = rows.map((r) => r.id); done[entity] = e; saveCkpt(); continue; }
      sheet = factSheetText(fs);
    } catch {
      e.uncovered = rows.map((r) => r.id);
      done[entity] = e; saveCkpt();
      continue;
    }

    for (const [i, r] of rows.entries()) {
      process.stdout.write(`\r   ${entity} ${i + 1}/${rows.length}…`.padEnd(50));
      try {
        const res = await verifyAgainstFacts({ question: r.question, options: r.options, answer: r.answer }, sheet);
        if (res.outcome === "disagree") {
          e.contradicted.push(r.id);
          contradicted.push({ ...r, derived: res.verdict.derived_answer, quote: res.verdict.source_quote });
        } else if (res.outcome === "verified") { e.confirmed.push(r.id); confirmed.push(r); }
        else { e.uncovered.push(r.id); uncovered.push(r); }
      } catch (err) {
        if (err instanceof CreditExhausted) throw err;  // out of credit ⇒ stop, don't burn on
        // A transient failure must not lose the run. Treat as uncovered (we never retire on
        // "unknown", so the safe default costs us nothing but a re-check later).
        e.uncovered.push(r.id);
        uncovered.push(r);
      }
    }
    done[entity] = e;
    saveCkpt();   // per-club checkpoint — a crash costs at most one club, not the whole sweep
  }
} catch (err) {
  if (err instanceof CreditExhausted) { console.error(`\n${err.message}`); saveCkpt(); process.exit(2); }
  saveCkpt();
  throw err;
}
process.stdout.write("\r".padEnd(50) + "\r");

console.log(`   ✓ confirmed by SportMonks:   ${confirmed.length}`);
console.log(`   ✗ CONTRADICTED (wrong):      ${contradicted.length}`);
console.log(`   ? not covered (left alone):  ${uncovered.length}\n`);

if (contradicted.length) {
  console.log(`── WRONG ANSWERS currently live (SportMonks contradicts the stored answer):\n`);
  for (const c of contradicted.slice(0, 10)) {
    console.log(`   ${c.entity}: ${c.question}`);
    console.log(`      stored answer:   ${c.options?.[c.answer]}`);
    console.log(`      SportMonks says: ${c.options?.[c.derived]}`);
    if (c.quote) console.log(`      "${String(c.quote).slice(0, 110)}"`);
    console.log();
  }
}

if (COMMIT && contradicted.length) {
  let done = 0;
  for (let i = 0; i < contradicted.length; i += 100) {
    const batch = contradicted.slice(i, i + 100);
    const { error } = await db
      .from("questions")
      .update({ status: "retired", verification_note: JSON.stringify({ retired_on: new Date().toISOString().slice(0, 10), reason: "SportMonks contradicts the stored answer" }) })
      .in("id", batch.map((r) => r.id));
    if (error) console.error(`   ✗ ${error.message}`);
    else done += batch.length;
  }
  console.log(`✓ retired ${done} contradicted questions\n`);
} else if (contradicted.length) {
  console.log(`REPORT ONLY — add --commit to retire the ${contradicted.length} contradicted questions.\n`);
}

console.log(`Cost:\n${costReport()}\n`);
