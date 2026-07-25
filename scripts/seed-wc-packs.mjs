/**
 * Publish the curated World Cup THEME packs (content/wc-packs/*.json) into quiz_packs.
 *
 * These are evergreen thematic packs distilled from the daily World Cup quiz series
 * (content/daily-quizzes/*.json) — reviewed, de-duplicated and grouped by headline
 * (Messi's records, the upsets, the hosts, the minnows, etc). Unlike the dailies they
 * are NOT date-gated and NOT marked daily: they are a back-catalogue a player can pick
 * any time.
 *
 * Deliberately NOT tagged `series: "wc2026"`. That tag routes a pack onto the World Cup
 * £100 leaderboard, and that was a closed, dated competition — retro-adding evergreen
 * packs to it would distort a finished board. These land as ordinary published packs in
 * the World Cup category (rotation_active=true, metadata.wc_theme=<slug>). Flip
 * `SERIES` below to "wc2026" only if the founder wants them scored on that board.
 *
 * Mirrors scripts/seed-daily-quiz.mjs:
 *   - upsert by name (update if the pack already exists, else insert)
 *   - status=published, source=system, rotation_active=true
 *   - icon stored in metadata.icon (no schema migration)
 *   - option order deterministically shuffled at publish via scripts/lib/shuffle-options
 *   - metadata MERGED on re-publish so an attached cover_image / share_image survives
 *   - never writes question_count (generated column in prod)
 *
 * Env (from .env.local): NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL),
 *                        SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   node scripts/seed-wc-packs.mjs                     # DRY RUN — all packs
 *   node scripts/seed-wc-packs.mjs --commit            # write all packs
 *   node scripts/seed-wc-packs.mjs <file.json> --commit  # write one pack
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { shufflePack } from "./lib/shuffle-options.mjs";
// @supabase/supabase-js is imported lazily below, only when --commit is set, so the
// dry-run (validate + shuffle preview) runs with no node_modules installed.

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACK_DIR = join(__dirname, "..", "content", "wc-packs");

const args = process.argv.slice(2);
const COMMIT = args.includes("--commit");
const fileArgs = args.filter((a) => a.endsWith(".json"));

// Set to "wc2026" only to score these on the World Cup leaderboard (see header).
const SERIES = null;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (COMMIT && !SUPABASE_URL) { console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL"); process.exit(1); }
if (COMMIT && !SERVICE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY required for --commit"); process.exit(1); }

const files = (fileArgs.length ? fileArgs : readdirSync(PACK_DIR).filter((f) => f.endsWith(".json")).sort().map((f) => join(PACK_DIR, f)));

const ALLOWED_DIFF = ["easy", "medium", "hard", "expert", "master"];
function validate(quiz) {
  const errs = [];
  if (!quiz.name || !quiz.parameter) errs.push("missing name/parameter");
  if (!Array.isArray(quiz.questions)) { errs.push("questions not an array"); return errs; }
  if (quiz.questions.length !== 15) errs.push(`expected 15 questions, got ${quiz.questions.length}`);
  const seen = new Set();
  quiz.questions.forEach((qq, i) => {
    const n = `Q${i + 1}`;
    if (!qq.question) errs.push(`${n}: empty question`);
    if (seen.has(qq.question)) errs.push(`${n}: duplicate question text`);
    seen.add(qq.question);
    if (!qq.options || !["A", "B", "C", "D"].every((k) => qq.options[k])) errs.push(`${n}: needs options A-D`);
    if (!["A", "B", "C", "D"].includes(qq.answer)) errs.push(`${n}: answer must be A-D`);
    if (!ALLOWED_DIFF.includes(qq.difficulty)) errs.push(`${n}: bad difficulty '${qq.difficulty}'`);
  });
  return errs;
}

let supabase = null;
if (COMMIT) {
  const { createClient } = await import("@supabase/supabase-js");
  supabase = createClient(SUPABASE_URL, SERVICE_KEY);
}

let order = 0;
for (const file of files) {
  const quiz = JSON.parse(readFileSync(file, "utf8"));
  const errs = validate(quiz);
  if (errs.length) {
    console.error(`\n✗ ${quiz.name || file}\n   ${errs.join("\n   ")}`);
    process.exit(1);
  }

  // Deterministic, name-keyed shuffle (same lib as the dailies). Idempotent on re-publish.
  quiz.questions = shufflePack(quiz.questions, quiz.name);

  const meta = { icon: quiz.icon, wc_theme: quiz.theme, curated: true, ...(SERIES ? { series: SERIES } : {}) };
  const row = {
    type: quiz.type || "records",
    name: quiz.name,
    parameter: quiz.parameter,
    questions: quiz.questions,
    status: "published",
    source: "system",
    featured: false,
    featured_order: order++,
    rotation_active: true,
    metadata: meta,
    updated_at: new Date().toISOString(),
  };

  if (!COMMIT) {
    console.log(`\n▷ ${quiz.name}  (${quiz.icon} ${quiz.theme})  — ${quiz.questions.length} Q`);
    continue;
  }

  const { data: existing } = await supabase.from("quiz_packs").select("id, metadata").eq("name", quiz.name).maybeSingle();
  if (existing?.id) {
    const mergedMeta = { ...(existing.metadata || {}), ...meta };
    const { error } = await supabase.from("quiz_packs").update({ ...row, metadata: mergedMeta }).eq("id", existing.id);
    if (error) { console.error(error); process.exit(1); }
    console.log(`  updated: ${quiz.name} (${existing.id})`);
  } else {
    const { data, error } = await supabase.from("quiz_packs").insert(row).select("id").single();
    if (error) { console.error(error); process.exit(1); }
    console.log(`  inserted: ${quiz.name} (${data.id})`);
  }
}

if (!COMMIT) console.log(`\nDRY RUN — ${files.length} pack(s). Re-run with --commit to publish.`);
else console.log(`\nDone. Published ${files.length} World Cup theme pack(s).`);
