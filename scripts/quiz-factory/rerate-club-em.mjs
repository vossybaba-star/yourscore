/**
 * Re-rate the ACTIVE expert/master club questions for the 20 in-rotation PL clubs, and
 * spot-check a random sample of the recovered ones through the full verify gate.
 *
 *   node --env-file=.env.local scripts/quiz-factory/rerate-club-em.mjs                 # REPORT (no writes)
 *   node --env-file=.env.local scripts/quiz-factory/rerate-club-em.mjs --sample 50     # + verify a sample
 *   node --env-file=.env.local scripts/quiz-factory/rerate-club-em.mjs --commit        # write new difficulties
 *
 * Why not rerate-live.mjs: that rates the WHOLE active bank (3,214 rows), including the
 * 1,891 already-servable ones whose level we are not questioning. This targets only the
 * rows the club pages are actually blocked on.
 *
 * Why these rows are worth recovering: they are `source='data-grounded'` with a
 * verification_note citing the API fact they were built from — the same machine that
 * produced the questions we already serve. They are excluded by DIFFICULTY LABEL
 * (expert/master are not served), not by quality. The genuinely unverified cohort is
 * `source='generated'`, which is 100% retired.
 *
 * Checkpointing: results are written to disk after EVERY batch, and a re-run resumes from
 * the checkpoint. A long paid job must never lose its work to a crash on the last batch.
 */

import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { rateBatch } from "./difficulty.mjs";
import { checkTemporal, checkSpecificity, checkShape, verifyQuestion } from "./verify.mjs";
import { costReport, CreditExhausted } from "../lib/anthropic.mjs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Missing Supabase env (run with --env-file=.env.local)"); process.exit(1); }
const db = createClient(url, key);

const arg = (f, d) => { const i = process.argv.indexOf(f); return i !== -1 ? process.argv[i + 1] : d; };
const COMMIT = process.argv.includes("--commit");
const SAMPLE = Number(arg("--sample", 0));
const BATCH = 25;
const CKPT = "/tmp/rerate-club-em.checkpoint.json";

const loadCkpt = () => { try { return JSON.parse(fs.readFileSync(CKPT, "utf8")); } catch { return { rated: [], verified: [] }; } };
const saveCkpt = (c) => { try { fs.writeFileSync(CKPT, JSON.stringify(c)); } catch { /* ignore */ } };

async function inRotationClubs() {
  const { data, error } = await db.from("quiz_packs").select("name")
    .eq("type", "club").eq("status", "published").eq("rotation_active", true);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.name);
}

async function fetchTargets(clubs) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("questions")
      .select("id, entity, category, difficulty, question, options, answer, verification_note")
      .eq("status", "active").eq("entity_type", "club").eq("source", "data-grounded")
      .in("difficulty", ["expert", "master"]).in("entity", clubs)
      .order("id", { ascending: true }).range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

const clubs = await inRotationClubs();
const targets = await fetchTargets(clubs);

console.log(`\n═══ RE-RATE CLUB EXPERT/MASTER ═══${COMMIT ? "  *** COMMIT ***" : "   (REPORT ONLY)"}\n`);
console.log(`In-rotation clubs:            ${clubs.length}`);
console.log(`Active expert/master rows:    ${targets.length}`);
console.log(`  with a verification_note:   ${targets.filter((r) => r.verification_note).length}`);

// Free gates first — cost nothing, and there is no point paying to rate a row we would drop.
const gated = [], rejected = [];
for (const r of targets) {
  const q = { question: r.question, options: r.options, answer: r.answer, difficulty: "medium" };
  const fails = !checkShape(q).ok || !checkTemporal(r.question).ok || !checkSpecificity(r.question).ok;
  (fails ? rejected : gated).push(r);
}
console.log(`Fails the free gates:         ${rejected.length}  (would be retired, not rated)`);
console.log(`To re-rate:                   ${gated.length}\n`);

// ── Re-rate, checkpointing after every batch ────────────────────────────────
const ckpt = loadCkpt();
const doneIds = new Set(ckpt.rated.map((r) => r.id));
const todo = gated.filter((r) => !doneIds.has(r.id));
if (ckpt.rated.length) console.log(`Resuming: ${ckpt.rated.length} already rated, ${todo.length} to go\n`);

try {
  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH);
    process.stdout.write(`\r   rating ${Math.min(i + BATCH, todo.length)}/${todo.length}…   `);
    const { rated: out } = await rateBatch(chunk.map((r) => ({ question: r.question, options: r.options, answer: r.answer })));
    out.forEach((o, j) => ckpt.rated.push({ id: chunk[j].id, entity: chunk[j].entity, category: chunk[j].category, was: chunk[j].difficulty, now: o.difficulty }));
    saveCkpt(ckpt); // after EVERY batch
  }
} catch (e) {
  saveCkpt(ckpt);
  if (e instanceof CreditExhausted) { console.error(`\n${e.message}\nCheckpoint saved — re-run to resume.`); process.exit(2); }
  console.error(`\n${e.message}\nCheckpoint saved — re-run to resume.`);
  process.exit(1);
}
process.stdout.write("\r".padEnd(46) + "\r");

const rated = ckpt.rated;
const tally = (rs) => rs.reduce((a, r) => ({ ...a, [r.now]: (a[r.now] ?? 0) + 1 }), {});
const t = tally(rated);
console.log("── Re-rated:\n");
for (const lvl of ["easy", "medium", "hard", "expert", "master"]) {
  const n = t[lvl] ?? 0;
  if (!n) continue;
  const pct = Math.round((n / rated.length) * 100);
  console.log(`   ${lvl.padEnd(7)} ${String(n).padStart(4)}  (${String(pct).padStart(3)}%)  ${"█".repeat(Math.round(pct / 3))}`);
}
const recovered = rated.filter((r) => ["easy", "medium", "hard"].includes(r.now));
console.log(`\n   → ${recovered.length} of ${rated.length} land in a SERVED tier and become reachable.\n`);

// ── Spot-check: measure the real error rate rather than assuming one ────────
if (SAMPLE > 0) {
  const byId = new Map(targets.map((r) => [r.id, r]));
  const pool = recovered.filter((r) => byId.has(r.id));
  // Deterministic spread across the pool, so the sample is not clustered on one club.
  const step = Math.max(1, Math.floor(pool.length / SAMPLE));
  const picked = [];
  for (let i = 0; i < pool.length && picked.length < SAMPLE; i += step) picked.push(pool[i]);

  const vDone = new Set(ckpt.verified.map((v) => v.id));
  const vTodo = picked.filter((p) => !vDone.has(p.id));
  console.log(`── Spot-check: verifying ${picked.length} of the recovered (${ckpt.verified.length} already done)\n`);

  try {
    for (let i = 0; i < vTodo.length; i++) {
      const row = byId.get(vTodo[i].id);
      process.stdout.write(`\r   verifying ${i + 1}/${vTodo.length}…   `);
      const res = await verifyQuestion({ question: row.question, options: row.options, answer: row.answer });
      ckpt.verified.push({ id: row.id, entity: row.entity, verified: !!res.verified, reason: res.reason ?? null, question: row.question.slice(0, 100) });
      saveCkpt(ckpt); // after EVERY question — a web search each, do not lose them
    }
  } catch (e) {
    saveCkpt(ckpt);
    console.error(`\n${e.message}\nCheckpoint saved — re-run to resume.`);
    process.exit(1);
  }
  process.stdout.write("\r".padEnd(46) + "\r");

  const v = ckpt.verified;
  const pass = v.filter((x) => x.verified).length;
  console.log(`   verified OK:  ${pass}/${v.length}  (${Math.round((pass / v.length) * 100)}%)`);
  console.log(`   flagged:      ${v.length - pass}\n`);
  const fails = v.filter((x) => !x.verified);
  if (fails.length) {
    console.log("   flagged questions:");
    for (const f of fails.slice(0, 15)) console.log(`     [${f.entity}] ${f.question}\n        → ${f.reason}`);
    console.log("");
  }
}

console.log(`Cost:\n${costReport()}\n`);

if (!COMMIT) {
  console.log("REPORT ONLY — nothing written. Re-run with --commit to apply the new difficulties.");
  process.exit(0);
}

// ── Write ──────────────────────────────────────────────────────────────────
// Cumulative tallies ("how many times have X ... since 2001-02") are held back: measured
// 1/5 through the verify gate against 43/45 for everything else, and they rot by design —
// the answer changes every time the club does the thing again. They stay at expert/master,
// which is exactly what that tier is for. Nothing is deleted; this is reversible.
const TALLY_SHAPE = /^how many\s+(times|seasons|of the)|how many .*\b(since|out of|in the period|between)\b/i;
const byIdAll = new Map(targets.map((r) => [r.id, r]));
const held = recovered.filter((r) => TALLY_SHAPE.test(byIdAll.get(r.id)?.question ?? ""));
const toWrite = recovered.filter((r) => !TALLY_SHAPE.test(byIdAll.get(r.id)?.question ?? ""));
console.log(`Holding back ${held.length} cumulative-count question(s) at expert/master (rot-prone).`);
console.log(`Writing ${toWrite.length} row(s).\n`);

let written = 0;
for (const r of toWrite) {
  const { error } = await db.from("questions").update({ difficulty: r.now }).eq("id", r.id);
  if (error) { console.error(`  update failed for ${r.id}: ${error.message}`); continue; }
  written++;
}
console.log(`Updated ${written} row(s) to a served difficulty tier.`);
