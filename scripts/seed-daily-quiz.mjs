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
if (errs.length) { errs.forEach((e) => console.log(`  ✗ ${e}`)); console.error("\nValidation failed — nothing written."); process.exit(1); }
console.log(`  ✓ valid`);

if (!COMMIT) {
  console.log(`\nDRY RUN — no database writes. Re-run with --commit to publish.`);
  process.exit(0);
}

// ── Write ────────────────────────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const row = {
  type: quiz.type || "records",
  name: quiz.name,
  parameter: quiz.parameter,
  questions: quiz.questions,
  status: "published",
  source: "system",
  featured: true,
  featured_order: ORDER,
  rotation_active: true,
  metadata: { icon: quiz.icon, daily: true, date: quiz.date },
  updated_at: new Date().toISOString(),
};

const { data: existing } = await supabase.from("quiz_packs").select("id").eq("name", quiz.name).maybeSingle();
let res;
if (existing?.id) {
  const { error } = await supabase.from("quiz_packs").update(row).eq("id", existing.id);
  if (error) { console.error(error); process.exit(1); }
  res = { action: "updated", id: existing.id };
} else {
  const { data, error } = await supabase.from("quiz_packs").insert(row).select("id").single();
  if (error) { console.error(error); process.exit(1); }
  res = { action: "inserted", id: data.id };
}
console.log(`\n  ${res.action}: ${quiz.name} (${res.id})`);
console.log(`\nDone. Published to the Featured surface at order ${ORDER}.`);
