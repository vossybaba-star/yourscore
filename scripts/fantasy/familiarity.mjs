/**
 * Scoring familiarity calibration — do YourScore points (deterministic, no BPS,
 * our own values/scale) produce rankings an FPL player's instincts recognise?
 *
 * Scores a REAL gameweek's raw match facts with our candidate point values and
 * compares the resulting player ranking against FPL's actual points that week.
 * Baseline: FPL-without-bonus vs FPL-total — the familiarity ceiling ANY
 * deterministic no-BPS system can reach.
 *
 * Usage: node scripts/fantasy/familiarity.mjs [gw] (default 30; fetches live data, caches)
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
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

// ── candidate YourScore values v1 (deterministic; distinct ~2.5× scale; no BPS)
function yourScore(pos, s) {
  let p = 0;
  p += s.minutes >= 60 ? 6 : s.minutes > 0 ? 3 : 0;
  p += s.goals_scored * (pos <= 2 ? 15 : pos === 3 ? 13 : 11);
  p += s.assists * 8;
  if (s.minutes >= 60 && s.clean_sheets) p += pos <= 2 ? 10 : pos === 3 ? 3 : 0;
  if (pos === 1) p += Math.floor(s.saves / 3) * 2 + s.penalties_saved * 12;
  if (pos <= 2) p -= Math.floor(s.goals_conceded / 2) * 2;
  p -= s.penalties_missed * 5 + s.yellow_cards * 3 + s.red_cards * 8 + s.own_goals * 5;
  const dc = (s.clearances_blocks_interceptions ?? 0) + (s.tackles ?? 0) + (pos > 2 ? (s.recoveries ?? 0) : 0);
  if (dc >= (pos === 2 ? 10 : 12)) p += 5; // defensive contribution, our value
  return p;
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
