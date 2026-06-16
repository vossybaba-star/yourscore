#!/usr/bin/env node
/**
 * Build the World Cup quiz pool for the 38-0 quiz-gated draft.
 *
 * Flattens every World Cup daily-quiz in content/daily-quizzes/ into a single bundle
 * (src/data/draft/wc-quiz.json) that the app imports at build time — deploy-safe (no
 * runtime fs reads). Re-run after new WC daily quizzes land:
 *
 *   node scripts/draft/build-wc-quiz.mjs
 *
 * Each daily file is { date, series?, questions: [{ difficulty, category, question,
 * options: {A,B,C,D}, answer: "A".."D" }] }. The WC daily series (June 2026 onward)
 * is the source; files without an explicit `series` are still the WC daily run, so we
 * include any file whose questions look like the standard 4-option shape.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = join(root, "content", "daily-quizzes");
const OUT = join(root, "src", "data", "draft", "wc-quiz.json");

const LETTERS = ["A", "B", "C", "D"];

const files = readdirSync(SRC).filter((f) => f.endsWith(".json")).sort();
const pool = [];
const seen = new Set();

for (const file of files) {
  let doc;
  try { doc = JSON.parse(readFileSync(join(SRC, file), "utf8")); } catch { continue; }
  const date = doc.date ?? file.replace(/\.json$/, "");
  const questions = Array.isArray(doc.questions) ? doc.questions : [];
  questions.forEach((q, i) => {
    const opts = q?.options;
    const answer = q?.answer;
    if (!q?.question || !opts || !LETTERS.includes(answer)) return;
    const options = LETTERS.map((L) => opts[L]).filter((v) => typeof v === "string");
    if (options.length !== 4) return;
    // Dedupe by question text so the same fact repeated across days only appears once.
    const key = q.question.trim().toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    pool.push({
      id: `${date}-${i}`,
      q: q.question.trim(),
      options,                       // canonical A,B,C,D order — the app re-shuffles per serve
      answer: LETTERS.indexOf(answer),
      difficulty: q.difficulty ?? "medium",
      category: q.category ?? "general",
    });
  });
}

writeFileSync(OUT, JSON.stringify({ generatedFrom: files, count: pool.length, questions: pool }, null, 2) + "\n");
console.log(`Wrote ${pool.length} WC quiz questions → ${OUT} (from ${files.length} daily files)`);
