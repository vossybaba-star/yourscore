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

// Only club questions can be checked against a club fact sheet.
//
// ⚠️ This used to filter to easy/medium/hard on the belief that expert/master were
// unreachable. THAT WAS WRONG, and it was skipping the tier most likely to be fabricated.
// `/api/quiz/start` is indeed typed "easy"|"medium"|"hard" — but that path has ~one user.
// The path people actually use is `/api/quiz/generate-custom` (build-your-own), and its
// Mixed mode explicitly draws 4 expert + 1 master out of every 15:
//     fetchByDifficulty(..., "expert", 4), fetchByDifficulty(..., "master", 1)
// It also accepts an explicit difficulty of "expert"/"master". So all 1,070 expert/master
// rows ARE in live rotation — including the Haaland-2010 fabrication (active, data-grounded,
// Manchester City). Sweep everything a player can be dealt.
const clubRows = survivors.filter((r) => r.entity_type === "club");
const entities = [...new Set(clubRows.map((r) => r.entity))];
console.log(`PASS 2 — SportMonks sweep over ${clubRows.length} club questions across ${entities.length} clubs`);
console.log(`   (no web search — a question SportMonks can't judge is LEFT ALONE, not retired)\n`);

const contradicted = [];
const confirmed = [];
const uncovered = [];

// Checkpointed PER QUESTION, keyed by question id → outcome.
//
// It was per-CLUB ("skip the whole club if it's in the file"), which broke the moment the
// sweep's scope widened to include expert/master: the 14 clubs already marked done would have
// skipped their expert rows — precisely the ones most likely to be fabricated. Keying on the
// question id means a scope change naturally picks up whatever is new, and a re-run is always
// safe.
//
// The old club-keyed file is migrated in rather than thrown away — it holds ~778 real checks.
const CKPT = join(process.cwd(), "scripts/data/sportmonks-cache/sweep-checkpoint.json");
/** @type {Record<string, "confirmed"|"contradicted"|"uncovered">} */
let done = {};
if (existsSync(CKPT)) {
  const raw = JSON.parse(readFileSync(CKPT, "utf8"));
  const isLegacy = Object.values(raw).some((v) => v && typeof v === "object" && Array.isArray(v.confirmed));
  if (isLegacy) {
    for (const e of Object.values(raw)) {
      for (const outcome of ["confirmed", "contradicted", "uncovered"]) {
        for (const id of e[outcome] ?? []) done[id] = outcome;
      }
    }
    console.log(`   ↻ migrated the old per-club checkpoint → ${Object.keys(done).length} question-level entries`);
  } else {
    done = raw;
  }
  const already = Object.keys(done).length;
  if (already) console.log(`   ↻ resuming — ${already} questions already checked\n`);
}
const saveCkpt = () => writeFileSync(CKPT, JSON.stringify(done));

// A contradiction found in an EARLIER run was recorded in the checkpoint but never retired —
// the retire step runs after the loop, and both previous attempts were killed before it. So
// rebuild the retire list from the checkpoint, or those known-wrong questions stay live for ever.
const carried = clubRows.filter((r) => done[r.id] === "contradicted");
if (carried.length) {
  contradicted.push(...carried.map((r) => ({ ...r, derived: null, quote: null })));
  console.log(`   ↻ carried ${carried.length} contradiction(s) forward from an earlier run (never retired — the run was killed first)\n`);
}

try {
  for (const entity of entities) {
    const rows = clubRows.filter((r) => r.entity === entity && !done[r.id]);
    if (!rows.length) continue; // every question for this club already checked

    let sheet;
    try {
      const fs = await clubFactSheet(entity, { fromYear: 2000 });
      if (!fs.seasons.length) { rows.forEach((r) => { done[r.id] = "uncovered"; }); saveCkpt(); continue; }
      sheet = factSheetText(fs);
    } catch {
      rows.forEach((r) => { done[r.id] = "uncovered"; });
      saveCkpt();
      continue;
    }

    for (const [i, r] of rows.entries()) {
      process.stdout.write(`\r   ${entity} ${i + 1}/${rows.length}…`.padEnd(50));
      try {
        const res = await verifyAgainstFacts({ question: r.question, options: r.options, answer: r.answer }, sheet);
        if (res.outcome === "disagree") {
          done[r.id] = "contradicted";
          contradicted.push({ ...r, derived: res.verdict.derived_answer, quote: res.verdict.source_quote });
        } else if (res.outcome === "verified") { done[r.id] = "confirmed"; confirmed.push(r); }
        else { done[r.id] = "uncovered"; uncovered.push(r); }
      } catch (err) {
        if (err instanceof CreditExhausted) throw err;  // out of credit ⇒ stop, don't burn on
        // A transient failure must not lose the run. Treat as uncovered (we never retire on
        // "unknown", so the safe default costs us nothing but a re-check later).
        done[r.id] = "uncovered";
        uncovered.push(r);
      }
    }
    saveCkpt();   // per-club save — a crash costs at most one club's worth of re-checks
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
