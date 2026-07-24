#!/usr/bin/env node
/**
 * Independently verify every question in the 38-0 Pro gate bundle.
 *
 *   node --env-file=.env.local scripts/draft/verify-pl-quiz.mjs            # all of them
 *   node --env-file=.env.local scripts/draft/verify-pl-quiz.mjs --limit 10 # cost probe
 *   node --env-file=.env.local scripts/draft/verify-pl-quiz.mjs --report   # read checkpoint only
 *
 * WHY THIS EXISTS. The founder's bar is zero wrong answers (2026-07-23). The build script's
 * filters only judge SHAPE — a question can be perfectly formed and still state a false fact.
 * Reading found three of those by hand (Forest's European Cups, West Ham's, Bournemouth's
 * nickname) and no filter caught any of them. 51% of the bundle carries no checkable source,
 * and the cheap SportMonks path can only judge ~55% of it because those fact sheets start at
 * 2000 while this bundle leans on 1966 finals, honours totals, stadiums and nicknames.
 *
 * So this runs the factory's REAL gate (verify.mjs `verifyQuestion`): a fresh context that is
 * never told the author's answer must search, derive the answer itself, and cite a URL.
 * Disagreement, no source, low confidence or flagged ambiguity all FAIL. A failure is a
 * success for this script — it's a wrong or unprovable answer caught before a player sees it.
 *
 * CHECKPOINTED after every single question, and resumes by default: this is a long job and
 * losing an hour of paid verification to a dropped connection is not acceptable.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyQuestion } from "../quiz-factory/verify.mjs";
import { costReport, CreditExhausted } from "../lib/anthropic.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BUNDLE = path.join(root, "src", "data", "draft", "pl-quiz.json");
const CHECKPOINT = path.join(root, "scripts", "data", "pl-quiz-verify.jsonl");

const arg = (f, d) => { const i = process.argv.indexOf(f); return i !== -1 ? process.argv[i + 1] : d; };
const LIMIT = Number(arg("--limit", 0));
const REPORT_ONLY = process.argv.includes("--report");
const CONCURRENCY = Number(arg("--concurrency", 4));

const LETTERS = ["A", "B", "C", "D"];

/** Bundle rows store options as a canonical A–D array + an answer index; the verifier wants
 *  letter-keyed options and a letter answer. The build script wrote them in that exact order,
 *  so this reconstruction is lossless and needs no DB round trip. */
const toVerifierShape = (q) => ({
  id: q.id,
  question: q.q,
  options: Object.fromEntries(q.options.map((o, i) => [LETTERS[i], o])),
  answer: LETTERS[q.answer],
});

const bundle = JSON.parse(fs.readFileSync(BUNDLE, "utf8"));
const all = bundle.questions.map(toVerifierShape);

// ── Checkpoint ───────────────────────────────────────────────────────────────

const done = new Map();
if (fs.existsSync(CHECKPOINT)) {
  for (const line of fs.readFileSync(CHECKPOINT, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); done.set(r.id, r); } catch { /* half-written line, redo it */ }
  }
}

function report() {
  const rows = [...done.values()];
  const pass = rows.filter((r) => r.verified);
  const fail = rows.filter((r) => !r.verified);
  const bucket = (re) => fail.filter((r) => re.test(r.reason || "")).length;
  console.log(`\n── VERIFIED ${rows.length}/${all.length} ──`);
  console.log(`  pass            : ${pass.length}`);
  console.log(`  FAIL            : ${fail.length}`);
  console.log(`    disagreement  : ${bucket(/DISAGREEMENT/)}   <- author's answer is WRONG`);
  console.log(`    unsettled     : ${bucket(/could not settle/)}`);
  console.log(`    no source     : ${bucket(/no source/)}`);
  console.log(`    low confidence: ${bucket(/low confidence/)}`);
  console.log(`    ambiguous     : ${bucket(/ambiguous/)}`);
  const wrong = fail.filter((r) => /DISAGREEMENT/.test(r.reason || ""));
  if (wrong.length) {
    console.log(`\n  WRONG ANSWERS FOUND (${wrong.length}):`);
    for (const w of wrong) console.log(`   - ${w.question}\n       ${w.reason}\n       source: ${w.source_url ?? "none"}`);
  }
  return { pass, fail };
}

if (REPORT_ONLY) { report(); process.exit(0); }

// ── Run ──────────────────────────────────────────────────────────────────────

const todo = all.filter((q) => !done.has(q.id)).slice(0, LIMIT || undefined);
console.log(`bundle ${all.length} · already verified ${done.size} · to do ${todo.length} · concurrency ${CONCURRENCY}`);

let n = 0;
let stopped = false;

async function work(q) {
  if (stopped) return;
  try {
    const res = await verifyQuestion(q);
    const row = {
      id: q.id,
      question: q.question,
      answer: q.answer,
      verified: !!res.verified,
      reason: res.reason ?? null,
      derived: res.verdict?.derived_answer ?? null,
      source_url: res.verdict?.source_url ?? null,
      confidence: res.verdict?.confidence ?? null,
    };
    // Append BEFORE anything else can fail. One line per question, so a crash costs one.
    fs.appendFileSync(CHECKPOINT, JSON.stringify(row) + "\n");
    done.set(q.id, row);
    n++;
    const mark = row.verified ? "ok " : (/DISAGREEMENT/.test(row.reason || "") ? "WRONG" : "drop");
    console.log(`[${done.size}/${all.length}] ${mark}  ${q.question.slice(0, 68)}`);
  } catch (err) {
    if (err instanceof CreditExhausted) { stopped = true; console.error("\nCREDIT EXHAUSTED — stopping. Re-run to resume."); return; }
    console.error(`  error on ${q.id}: ${err.message}`);
  }
}

const queue = [...todo];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length && !stopped) await work(queue.shift());
}));

report();
try { costReport(); } catch { /* optional */ }
console.log(`\ncheckpoint: ${path.relative(root, CHECKPOINT)}`);
