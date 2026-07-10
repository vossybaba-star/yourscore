/**
 * Scoring familiarity calibration — do YourScore points (deterministic, no BPS,
 * our own values/scale) produce rankings an FPL player's instincts recognise?
 *
 * Scores a REAL gameweek's raw match facts with our candidate point values and
 * compares the resulting player ranking against FPL's actual points that week.
 * Baseline: FPL-without-bonus vs FPL-total — the familiarity ceiling ANY
 * deterministic no-BPS system can reach.
 *
 * Usage: bash scripts/fantasy/familiarity.sh [gw]   (compiles values.ts then runs this)
 * Values come from src/lib/fantasy/values.ts — THE game engine's scoring source —
 * so this harness IS the acceptance test for any change to the values (≥ 0.98 bar).
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const valuesPath = join(root, ".tmp-fantasy-val/lib/fantasy/values.js");
if (!existsSync(valuesPath)) {
  console.error("compiled values not found — run: bash scripts/fantasy/familiarity.sh");
  process.exit(1);
}
const { pointsFor, ZERO_FACTS } = await import(valuesPath);
const GW = Number(process.argv[2] ?? 30);
const cachePath = join(root, `scripts/data/gw${GW}-live.json`);

const boot = JSON.parse(readFileSync(join(root, "scripts/data/fpl-bootstrap-cache.json"), "utf8"));
const POS = new Map(boot.elements.map((e) => [e.id, e.element_type])); // 1 GK 2 DEF 3 MID 4 FWD
const NAME = new Map(boot.elements.map((e) => [e.id, e.web_name]));

let live;
if (existsSync(cachePath)) live = JSON.parse(readFileSync(cachePath, "utf8"));
else {
  const res = await fetch(`https://fantasy.premierleague.com/api/event/${GW}/live/`);
  live = await res.json();
  writeFileSync(cachePath, JSON.stringify(live));
}

// ── FPL live stats → MatchFacts → pointsFor (src/lib/fantasy/values.ts) ──────
const POS_NAME = { 1: "GK", 2: "DEF", 3: "MID", 4: "FWD" };
function yourScore(pos, s) {
  const cbit = (s.clearances_blocks_interceptions ?? 0) + (s.tackles ?? 0);
  return pointsFor(POS_NAME[pos] ?? "MID", {
    ...ZERO_FACTS,
    minutes: s.minutes, goals: s.goals_scored, assists: s.assists,
    cleanSheet: s.clean_sheets, conceded: s.goals_conceded, saves: s.saves,
    pensSaved: s.penalties_saved, pensMissed: s.penalties_missed,
    yellows: s.yellow_cards, reds: s.red_cards, ownGoals: s.own_goals,
    dc: cbit, dcRec: cbit + (s.recoveries ?? 0),
  });
}

const rows = live.elements
  .filter((e) => e.stats.minutes > 0)
  .map((e) => ({
    id: e.id, name: NAME.get(e.id) ?? "?", pos: POS.get(e.id) ?? 3,
    fpl: e.stats.total_points, fplNoBonus: e.stats.total_points - e.stats.bonus,
    ours: yourScore(POS.get(e.id) ?? 3, e.stats),
  }));

function spearman(a, b) {
  const rank = (v) => { const idx = v.map((x, i) => [x, i]).sort((p, q) => q[0] - p[0]); const r = new Array(v.length);
    let i = 0; while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; } return r; };
  const ra = rank(a), rb = rank(b), n = a.length;
  const ma = ra.reduce((s, x) => s + x, 0) / n, mb = rb.reduce((s, x) => s + x, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2; }
  return num / Math.sqrt(da * db);
}

const topN = (key, n = 20) => new Set([...rows].sort((a, b) => b[key] - a[key]).slice(0, n).map((r) => r.id));
const overlap = (A, B) => [...A].filter((x) => B.has(x)).length;

const rOurs = spearman(rows.map((r) => r.ours), rows.map((r) => r.fpl));
const rCeil = spearman(rows.map((r) => r.fplNoBonus), rows.map((r) => r.fpl));
const t20 = overlap(topN("ours"), topN("fpl"));
const t20ceil = overlap(topN("fplNoBonus"), topN("fpl"));

console.log(`═══ SCORING FAMILIARITY — GW${GW}, ${rows.length} players who played ═══`);
console.log(`  Spearman rank corr, OURS vs FPL actual:        ${rOurs.toFixed(3)}`);
console.log(`  ceiling (FPL-without-bonus vs FPL actual):     ${rCeil.toFixed(3)}   ← best any no-BPS system can do`);
console.log(`  top-20 overlap, OURS vs FPL:                   ${t20}/20   (ceiling ${t20ceil}/20)`);
const scale = rows.reduce((s, r) => s + r.ours, 0) / Math.max(1, rows.reduce((s, r) => s + r.fpl, 0));
console.log(`  scale distinctness: ours ≈ ${scale.toFixed(2)}× FPL numbers (top score ours ${Math.max(...rows.map(r=>r.ours))} vs FPL ${Math.max(...rows.map(r=>r.fpl))})`);
console.log(`\n  Top 10 — ours vs FPL:`);
const byOurs = [...rows].sort((a, b) => b.ours - a.ours).slice(0, 10);
const fplRank = new Map([...rows].sort((a, b) => b.fpl - a.fpl).map((r, i) => [r.id, i + 1]));
for (const r of byOurs) console.log(`   ${r.name.padEnd(16)} ours ${String(r.ours).padStart(3)} · FPL ${String(r.fpl).padStart(2)} (their rank #${fplRank.get(r.id)})`);
