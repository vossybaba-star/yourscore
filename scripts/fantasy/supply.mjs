/**
 * Question supply & repeat-exposure test — can the generators feed a weekly
 * game for a full season without feeling stale?
 *
 * (a) CAPACITY: exact count of distinct clean questions available per format —
 *     comparison formats counted combinatorially from the real player data
 *     (same validity rules as higher-lower.ts: margin ≥ 0.15, min top value);
 *     archive formats counted from the live pool snapshot + known data bounds.
 * (b) EXPOSURE: a player draws 11 questions/week for 38 weeks (per-user
 *     variation = independent draws). How many repeats do they see per season
 *     at different pool sizes?
 *
 * Usage: node scripts/fantasy/supply.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const boot = JSON.parse(readFileSync(join(root, "scripts/data/fpl-bootstrap-cache.json"), "utf8"));
const pool = JSON.parse(readFileSync(join(root, "src/data/gates/pool.json"), "utf8"));

// ── (a) capacity: comparison pairs, same rules as higher-lower.ts ─────────────
const els = boot.elements.map((e) => ({
  price: e.now_cost / 10, goals: e.goals_scored, points: e.total_points,
  minutes: e.minutes, available: e.status === "a",
}));
const MIN_TOP = { price: 0, goals: 2, points: 20 };
const valid = (va, vb, minTop) => {
  if (va === vb) return false;
  const top = Math.max(Math.abs(va), Math.abs(vb));
  if (top < minTop) return false;
  return Math.abs(va - vb) / (top || 1) >= 0.15;
};
function countPairs(rows, stat) {
  let n = 0;
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++)
    if (valid(rows[i][stat], rows[j][stat], MIN_TOP[stat])) n++;
  return n;
}
const starters = els.filter((e) => e.available && e.minutes >= 450);
const capacity = {
  "higher-lower (price)": countPairs(els, "price"),
  "higher-lower (goals)": countPairs(els, "goals"),
  "this-season-form (points, starters)": countPairs(starters, "points"),
  "this-season-form (goals, starters)": countPairs(starters, "goals"),
};

const byFormat = {};
for (const q of pool.questions) byFormat[q.format] = (byFormat[q.format] ?? 0) + 1;

console.log("═══ (a) CAPACITY — distinct clean questions available ═══");
for (const [k, v] of Object.entries(capacity)) console.log(`  ${k.padEnd(38)} ${v.toLocaleString()} pairs (exact, from real data)`);
console.log(`  who-am-i                               ~1 per clean player ≈ 300–400/season (SM-enriched; snapshot has ${byFormat["who-am-i"] ?? 0})`);
console.log(`  classic-trivia                         bounded by history: 26 seasons × ~2 types ≈ 50–60 total (snapshot ${byFormat["classic-trivia"] ?? 0})`);
console.log(`  career-path                            bounded by eligible careers ≈ 150–200 (snapshot ${byFormat["career-path"] ?? 0})`);
console.log(`  current pool snapshot total: ${pool.questions.length} questions`, byFormat);

// ── (b) exposure: repeats per season vs pool size ─────────────────────────────
function xfnv1a(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

console.log("\n═══ (b) EXPOSURE — one player, 11 Qs/week × 38 weeks (418 draws), 500 simulated players ═══");
console.log("  pool size → repeated questions seen per season (median) · % of all draws that are repeats");
for (const N of [314, 1000, 2000, 5000, 10000, 25000]) {
  const reps = [];
  for (let u = 0; u < 500; u++) {
    const rng = mulberry32(xfnv1a(`exp:${N}:${u}`));
    const seen = new Set(); let repeats = 0;
    for (let w = 0; w < 38; w++) {
      const week = new Set();
      while (week.size < 11) week.add(Math.floor(rng() * N)); // distinct within a week
      for (const q of week) { if (seen.has(q)) repeats++; seen.add(q); }
    }
    reps.push(repeats);
  }
  reps.sort((a, b) => a - b);
  const med = reps[250];
  console.log(`  ${String(N).padStart(6)} → ${String(med).padStart(3)} repeats/season · ${(med / 418 * 100).toFixed(1)}% of draws`);
}
console.log("\n  NOTE: weekly pool ROTATION (fresh seed each week — new comparison pairs from the same");
console.log("  data) makes the effective pool the CAPACITY numbers above, not the snapshot size.");
