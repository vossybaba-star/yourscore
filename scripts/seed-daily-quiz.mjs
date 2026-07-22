/**
 * Publish a daily quiz JSON (content/daily-quizzes/*.json) into quiz_packs as a
 * featured pack. Mirrors scripts/seed-featured-packs.mjs:
 *   - upsert by name (update if the pack already exists, else insert)
 *   - status=published, source=system, featured=true, rotation_active=true
 *   - icon stored in metadata.icon (no schema migration)
 *   - never writes question_count (generated column in prod)
 *
 * Env (from .env.local): NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL),
 *                        SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   node scripts/seed-daily-quiz.mjs <file.json>                 # DRY RUN
 *   node scripts/seed-daily-quiz.mjs <file.json> --commit        # write
 *   node scripts/seed-daily-quiz.mjs <file.json> --order 0 --commit
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const COMMIT = args.includes("--commit");
const fileArg = args.find((a) => a.endsWith(".json"));
const orderIdx = args.indexOf("--order");
const ORDER = orderIdx !== -1 ? Number(args[orderIdx + 1]) : 0;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!fileArg) { console.error("Pass a quiz JSON file path."); process.exit(1); }
if (!SUPABASE_URL) { console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL"); process.exit(1); }
if (COMMIT && !SERVICE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY required for --commit"); process.exit(1); }

const quiz = JSON.parse(readFileSync(fileArg, "utf8"));

const LETTERS = ["A", "B", "C", "D"];

// ── Option shuffling ───────────────────────────────────────────────────────────
// Authors tend to write the correct answer as option A every time, so a raw pack
// has the answer sitting in slot A for all 15 questions — and the challenge page
// renders options in fixed A→D order with no client shuffle, making the answer
// always the first choice. We fix that here at publish time: randomise each
// question's option positions and recompute the answer letter so the correct
// answer is spread across A–D.
//
// Deterministic on purpose. The seed is derived from the date + question index +
// question text, so re-publishing the same file yields the same shuffle — idempotent
// with the upsert-by-name flow below, and stable for anyone who already saw the pack.
function hashSeed(str) {
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleOptions(q, i) {
  if (!q?.options || !LETTERS.every((k) => q.options[k]) || !LETTERS.includes(q.answer)) {
    return q; // leave malformed questions untouched — validation will flag them
  }
  const rng = mulberry32(hashSeed(`${quiz.date ?? quiz.name}-${i}-${q.question}`));
  const order = [...LETTERS];
  for (let j = order.length - 1; j > 0; j--) {
    const k = Math.floor(rng() * (j + 1));
    [order[j], order[k]] = [order[k], order[j]];
  }
  // order[slot] = original letter now placed in that slot.
  const options = {};
  LETTERS.forEach((slot, idx) => { options[slot] = q.options[order[idx]]; });
  const answer = LETTERS[order.indexOf(q.answer)];
  return { ...q, options, answer };
}

if (Array.isArray(quiz.questions)) {
  quiz.questions = quiz.questions.map((q, i) => shuffleOptions(q, i));
}

// ── Validation ───────────────────────────────────────────────────────────────
const ALLOWED_DIFF = ["easy", "medium", "hard", "expert", "master"];
function validate(q) {
  const errs = [];
  if (!quiz.name || !quiz.parameter) errs.push("missing name/parameter");
  if (!Array.isArray(quiz.questions)) { errs.push("questions not an array"); return errs; }
  if (quiz.questions.length !== 15) errs.push(`expected 15 questions, got ${quiz.questions.length}`);
  quiz.questions.forEach((qq, i) => {
    const n = `Q${i + 1}`;
    if (!qq.question) errs.push(`${n}: empty question`);
    if (!qq.options || !["A", "B", "C", "D"].every((k) => qq.options[k])) errs.push(`${n}: needs options A-D`);
    if (!["A", "B", "C", "D"].includes(qq.answer)) errs.push(`${n}: answer must be A-D`);
    if (!ALLOWED_DIFF.includes(qq.difficulty)) errs.push(`${n}: bad difficulty '${qq.difficulty}'`);
  });
  return errs;
}

const errs = validate(quiz);
console.log(`\n• ${quiz.name}`);
console.log(`  parameter=${quiz.parameter}  icon=${quiz.icon}  questions=${quiz.questions?.length}  featured_order=${ORDER}`);
const diffs = {};
for (const qq of quiz.questions ?? []) diffs[qq.difficulty] = (diffs[qq.difficulty] ?? 0) + 1;
console.log(`  difficulty mix: ${JSON.stringify(diffs)}`);
const ansDist = {};
for (const qq of quiz.questions ?? []) ansDist[qq.answer] = (ansDist[qq.answer] ?? 0) + 1;
console.log(`  answer spread (post-shuffle): ${JSON.stringify(ansDist)}`);
if (errs.length) { errs.forEach((e) => console.log(`  ✗ ${e}`)); console.error("\nValidation failed — nothing written."); process.exit(1); }
console.log(`  ✓ valid`);

if (!COMMIT) {
  console.log(`\nDRY RUN — no database writes. Re-run with --commit to publish.`);
  process.exit(0);
}

// ── Write ────────────────────────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// series tags the pack into the World Cup leaderboard (the £100 board); daily +
// date drive the streak deadline. Defaults to wc2026 unless the JSON overrides.
const dailyMeta = { icon: quiz.icon, daily: true, date: quiz.date, series: quiz.series || "wc2026" };

const row = {
  type: quiz.type || "records",
  name: quiz.name,
  parameter: quiz.parameter,
  questions: quiz.questions,
  status: "published",
  source: "system",
  // Daily quizzes are no longer surfaced in Featured — they live in the World Cup
  // category via rotation_active. Founder call, 2026-07-11.
  featured: false,
  featured_order: ORDER,
  rotation_active: true,
  metadata: dailyMeta,
  updated_at: new Date().toISOString(),
};

const { data: existing } = await supabase.from("quiz_packs").select("id, metadata").eq("name", quiz.name).maybeSingle();
let res;
if (existing?.id) {
  // MERGE metadata on re-publish — never clobber an attached cover_image / share_image
  // (set later by set-quiz-share-image.mjs). Only the daily fields are refreshed.
  const mergedMeta = { ...(existing.metadata || {}), ...dailyMeta };
  const { error } = await supabase.from("quiz_packs").update({ ...row, metadata: mergedMeta }).eq("id", existing.id);
  if (error) { console.error(error); process.exit(1); }
  res = { action: "updated", id: existing.id };
} else {
  const { data, error } = await supabase.from("quiz_packs").insert(row).select("id").single();
  if (error) { console.error(error); process.exit(1); }
  res = { action: "inserted", id: data.id };
}
console.log(`\n  ${res.action}: ${quiz.name} (${res.id})`);
console.log(`\nDone. Published to the Featured surface at order ${ORDER}.`);
