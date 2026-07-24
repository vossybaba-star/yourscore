/**
 * Remap the live bank's SIX legacy categories onto the FOUR locked ones.
 *
 *   node --env-file=.env.local scripts/quiz-factory/remap-categories.mjs           # REPORT
 *   node --env-file=.env.local scripts/quiz-factory/remap-categories.mjs --commit  # apply
 *   node --env-file=.env.local scripts/quiz-factory/remap-categories.mjs --revert <backup.json>
 *
 * Deterministic. No API calls, no cost.
 *
 * Why this matters more than generating: 2,207 verified questions across 44 clubs are
 * invisible to the category flow because they carry the old labels, while only 69 questions
 * (Arsenal alone) carry the new ones. Pick Chelsea → Legends today and you get nothing. This
 * rehomes what already exists before spending anything on new content.
 *
 * THE MAPPING
 *   Trophies & Honours   → history-honours          (obvious)
 *   Club History         → history-honours          (founding years, nicknames)
 *   Stadiums & Grounds   → history-honours          (no better home among the four; and these
 *                                                    are a hidden seam of EASY questions —
 *                                                    "What is Brighton's home ground?")
 *   Players & Goals      → legends                  (player-centric)
 *   Records & Milestones → by era                   (club stats — "Stoke's top-half finishes",
 *                                                    "goals conceded" — NOT player legends)
 *   Season Performance   → by era                   (league-season questions)
 *
 * THE ERA SPLIT: modern-era is defined as 2015 onwards, so anything with a later season goes
 * there and everything older is club history. Every Season Performance row carries a parseable
 * year (verified: 1438/1438), which is why this needs no model.
 *
 * It also re-applies the era rule to rows ALREADY tagged with the new categories — 18 of 19
 * Arsenal "modern-era" questions are pre-2015 and belong in history-honours.
 *
 * SAFETY: writes a backup of every (id, old category) to disk BEFORE touching anything, and
 * --revert replays it. Today has needed several undos; this one is cheap to make reversible.
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Missing Supabase env (source .env.local)"); process.exit(1); }
const db = createClient(url, key);

const COMMIT = process.argv.includes("--commit");
const revertIdx = process.argv.indexOf("--revert");
const REVERT_FILE = revertIdx !== -1 ? process.argv[revertIdx + 1] : null;

const BACKUP_DIR = join(process.cwd(), "scripts/data");
const MODERN_FROM = 2015;

/** Straight renames — no era judgement needed. */
const DIRECT = {
  "Trophies & Honours": "history-honours",
  "Club History": "history-honours",
  "Stadiums & Grounds": "history-honours",
  "Players & Goals": "legends",
};

/** These depend on WHEN the question is about. */
const BY_ERA = new Set(["Season Performance", "Records & Milestones"]);

/** Already-new categories that must still obey the era rule (modern-era means 2015+). */
const NEW_CATEGORIES = new Set(["history-honours", "legends", "modern-era", "rivalries-derbies"]);

/**
 * The latest season/year a question refers to. Latest, not first, because "the club's best
 * season since 2001-02" is a question about the whole span — its recency is the later bound.
 */
export function latestYear(text) {
  const years = [...String(text).matchAll(/\b(19|20)\d{2}\b/g)].map((m) => Number(m[0]));
  return years.length ? Math.max(...years) : null;
}

/** The new category for a row, or null to leave it alone. */
export function remap(row) {
  const { category, question } = row;

  if (DIRECT[category]) return DIRECT[category];

  if (BY_ERA.has(category)) {
    const yr = latestYear(question);
    // No year at all ⇒ can't call it modern. Club history is the safe default.
    return yr && yr >= MODERN_FROM ? "modern-era" : "history-honours";
  }

  // Already on the new scheme: only fix modern-era rows that aren't actually modern.
  if (category === "modern-era") {
    const yr = latestYear(question);
    if (yr && yr < MODERN_FROM) return "history-honours";
    return null; // correctly tagged
  }
  if (NEW_CATEGORIES.has(category)) return null; // leave legends/history/rivalries as-is

  return null; // unknown legacy label — don't guess
}

// ── Revert ────────────────────────────────────────────────────────────────────
if (REVERT_FILE) {
  const backup = JSON.parse(readFileSync(REVERT_FILE, "utf8"));
  console.log(`\n↩  Reverting ${backup.length} questions to their previous categories…\n`);
  let done = 0;
  for (const b of backup) {
    const { error } = await db.from("questions").update({ category: b.from }).eq("id", b.id);
    if (error) console.error(`   ✗ ${b.id}: ${error.message}`);
    else done++;
  }
  console.log(`✓ reverted ${done}/${backup.length}\n`);
  process.exit(0);
}

// ── Load ──────────────────────────────────────────────────────────────────────
const rows = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db
    .from("questions")
    .select("id, entity, entity_type, category, difficulty, question")
    .eq("status", "active")
    .order("id", { ascending: true })
    .range(from, from + 999);
  if (error) { console.error(error.message); process.exit(1); }
  rows.push(...(data ?? []));
  if (!data || data.length < 1000) break;
}

const changes = [];
for (const r of rows) {
  const to = remap(r);
  if (to && to !== r.category) changes.push({ id: r.id, entity: r.entity, from: r.category, to, question: r.question, difficulty: r.difficulty });
}

console.log(`\n═══ CATEGORY REMAP ═══${COMMIT ? "" : "   (REPORT ONLY — nothing written)"}\n`);
console.log(`Scanned ${rows.length} active questions · ${changes.length} to remap\n`);

const flow = {};
for (const c of changes) {
  const k = `${c.from}  →  ${c.to}`;
  flow[k] = (flow[k] ?? 0) + 1;
}
for (const [k, n] of Object.entries(flow).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(5)}  ${k}`);
}

// What the bank looks like afterwards — the number that decides whether the flow works.
const after = {};
for (const r of rows) {
  const to = remap(r) ?? r.category;
  if (!NEW_CATEGORIES.has(to)) continue;
  (after[to] ??= { total: 0, easy: 0, clubs: new Set() });
  after[to].total++;
  if (r.difficulty === "easy") after[to].easy++;
  if (r.entity_type === "club") after[to].clubs.add(r.entity);
}
console.log(`\nBank AFTER the remap:\n`);
console.log(`  category            questions   easy   clubs covered`);
for (const [cat, v] of Object.entries(after).sort((a, b) => b[1].total - a[1].total)) {
  console.log(`  ${cat.padEnd(20)} ${String(v.total).padStart(7)}  ${String(v.easy).padStart(5)}   ${v.clubs.size}`);
}

// Can a club actually be dealt a 15-question category quiz (2 easy / 5 medium / 8 hard)?
const perClub = {};
for (const r of rows) {
  if (r.entity_type !== "club") continue;
  const cat = remap(r) ?? r.category;
  if (!NEW_CATEGORIES.has(cat)) continue;
  const k = `${r.entity}||${cat}`;
  (perClub[k] ??= { easy: 0, medium: 0, hard: 0 })[r.difficulty] ??= 0;
  perClub[k][r.difficulty] = (perClub[k][r.difficulty] ?? 0) + 1;
}
const playable = Object.entries(perClub).filter(([, v]) => v.easy >= 2 && v.medium >= 5 && v.hard >= 8);
console.log(`\n  Club×category combos that can deal a FULL 15-question quiz: ${playable.length}`);
console.log(`  (was 3 before the remap — Arsenal only)\n`);

if (!COMMIT) {
  console.log(`Samples of what moves:\n`);
  for (const c of changes.slice(0, 6)) console.log(`  [${c.from} → ${c.to}] ${c.question.slice(0, 78)}`);
  console.log(`\nREPORT ONLY — re-run with --commit to apply.\n`);
  process.exit(0);
}

// ── Backup, then write ────────────────────────────────────────────────────────
if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupFile = join(BACKUP_DIR, `category-remap-backup-${stamp}.json`);
writeFileSync(backupFile, JSON.stringify(changes.map(({ id, from }) => ({ id, from })), null, 0));
console.log(`💾 backup → ${backupFile}`);
console.log(`   revert with: node --env-file=.env.local scripts/quiz-factory/remap-categories.mjs --revert ${backupFile}\n`);

// Group by target so this is 4 statements, not 2,000.
const byTarget = {};
for (const c of changes) (byTarget[c.to] ??= []).push(c.id);

let done = 0;
for (const [to, ids] of Object.entries(byTarget)) {
  for (let i = 0; i < ids.length; i += 200) {
    const batch = ids.slice(i, i + 200);
    const { error } = await db.from("questions").update({ category: to }).in("id", batch);
    if (error) console.error(`   ✗ ${to}: ${error.message}`);
    else done += batch.length;
  }
  console.log(`  ✓ ${to}: ${ids.length}`);
}
console.log(`\n✓ remapped ${done} questions\n`);
