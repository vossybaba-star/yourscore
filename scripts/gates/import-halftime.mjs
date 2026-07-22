/**
 * Import halftime-quiz questions into the weekly round's pool (founder, 22 Jul:
 * "it'll be good if the actual questions were current and based on recent stuff
 * … taking them from what is generated from the half-time quizzes … right
 * categories, not obscure").
 *
 * Source: halftime_releases.pack_questions — the FROZEN, fact-check-gated
 * content the halftime factory already produced for real fixtures. This tool
 * converts what survives its filters into gates classic-trivia format and
 * appends to src/data/gates/pool.json (the weekly round's finite-trivia slice —
 * currently 44 questions, the one category that repeats without fresh supply).
 *
 * Filters — "right categories, not obscure":
 *   - approved questions only (the factory's own gate has passed them)
 *   - NOTHING match-anchored: any wording that only made sense at that halftime
 *     ("tonight", "so far", "this match", "current score"…) is rejected — the
 *     weekly round is played days later
 *   - the base slate register only: club/player history questions travel;
 *     the fresh slice is halftime-of-THIS-match by definition, never imported
 *   - dedupe against every prompt already in the pool
 *
 * REVIEW-FIRST: default run prints what it WOULD add and writes nothing.
 * --apply appends (then commit the pool like any content change).
 *
 *   node --env-file=.env.local scripts/gates/import-halftime.mjs [--apply] [--since 2026-08-01]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const sinceIdx = args.indexOf("--since");
const SINCE = sinceIdx >= 0 ? args[sinceIdx + 1] : new Date(Date.now() - 28 * 864e5).toISOString().slice(0, 10);

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Wording that anchors a question to the moment it was asked. One hit = rejected.
const MATCH_ANCHORED = /\b(today|tonight|this (match|game|fixture|season's opener)|so far|currently|at half[- ]?time|first half|the score|right now|this weekend|yesterday)\b/i;

const poolPath = join(root, "src/data/gates/pool.json");
const pool = JSON.parse(readFileSync(poolPath, "utf8"));
const existingPrompts = new Set(pool.questions.map((q) => q.prompt.toLowerCase().trim()));
// Gates option ids are numeric; halftime options are A-D strings. Mint fresh ids
// well clear of the FPL-element range so nothing can collide with player ids.
let nextId = Math.max(0, ...pool.questions.flatMap((q) => q.options.map((o) => o.id))) + 1000;

// base_questions is the evergreen slate — the right source. The fresh slice is
// halftime-of-THIS-match by definition; pack_questions mixes both, so it's only
// the fallback for old rows.
const { data: releases, error } = await db.from("halftime_releases")
  .select("fixture_id, base_questions, pack_questions, created_at")
  .gte("created_at", `${SINCE}T00:00:00Z`).range(0, 999);
if (error) { console.error("halftime_releases:", error.message); process.exit(1); }

const candidates = [];
const rejected = { anchored: 0, dupe: 0, malformed: 0, unapproved: 0 };
const TEST = args.includes("--test");
const testRows = TEST ? [{ fixture_id: 0, base_questions: [
  { question: "Which club has won the most Premier League titles?", options: { A: "Manchester United", B: "Manchester City", C: "Chelsea", D: "Arsenal" }, answer: "A", difficulty: 2, fact: "13 titles", status: "approved" },
  { question: "Who is leading the scoring so far tonight?", options: { A: "x", B: "y", C: "z", D: "w" }, answer: "A", difficulty: 1, status: "approved" },
  { question: "Who won the Premier League in 2000/01?", options: { A: "Manchester United", B: "Liverpool", C: "Leeds United", D: "Arsenal" }, answer: "A", difficulty: 3, status: "approved" },
  { question: "Vetoed thing", options: { A: "a", B: "b", C: "c", D: "d" }, answer: "A", difficulty: 3, status: "vetoed" },
] }] : [];
for (const rel of [...(releases ?? []), ...testRows]) {
  for (const q of rel.base_questions ?? rel.pack_questions ?? []) {
    if (q.status && q.status !== "approved") { rejected.unapproved++; continue; }
    const prompt = String(q.question ?? "").trim();
    const opts = q.options && typeof q.options === "object" ? Object.entries(q.options) : [];
    const answerKey = String(q.answer ?? "").trim();
    if (!prompt || opts.length !== 4 || !opts.some(([k]) => k === answerKey)) { rejected.malformed++; continue; }
    if (MATCH_ANCHORED.test(prompt)) { rejected.anchored++; continue; }
    if (existingPrompts.has(prompt.toLowerCase())) { rejected.dupe++; continue; }
    existingPrompts.add(prompt.toLowerCase());

    const options = opts.map(([, label]) => ({ id: nextId++, label: String(label) }));
    const answerId = options[opts.findIndex(([k]) => k === answerKey)].id;
    candidates.push({
      format: "classic-trivia",
      prompt,
      options,
      answerId,
      // The factory grades difficulty 1-5-ish; gates uses 0-100. Map conservatively
      // toward the middle — "not obscure" is enforced by the filters, not the score.
      difficulty: Math.min(100, Math.max(20, Math.round((Number(q.difficulty) || 3) * 20))),
      positions: ["GK", "DEF", "MID", "FWD"],
      meta: { source: "halftime", fixtureId: rel.fixture_id, fact: q.fact ?? "" },
    });
  }
}

console.log(`halftime releases since ${SINCE}: ${releases?.length ?? 0}`);
console.log(`importable questions: ${candidates.length} · rejected: ${JSON.stringify(rejected)}`);
for (const c of candidates.slice(0, 12)) console.log(`  + ${c.prompt}`);
if (candidates.length > 12) console.log(`  … and ${candidates.length - 12} more`);

if (!APPLY) { console.log("\n(review run — nothing written. --apply to append to the pool.)"); process.exit(0); }
if (!candidates.length) { console.log("\nnothing to apply."); process.exit(0); }
pool.questions.push(...candidates);
writeFileSync(poolPath, JSON.stringify(pool));
console.log(`\n✅ appended ${candidates.length} — pool now ${pool.questions.length} questions. Commit pool.json to ship.`);
