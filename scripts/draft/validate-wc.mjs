#!/usr/bin/env node
/**
 * Draft XI — World Cup Run validation.
 *
 * Cross-references the pool's playable nations (enough PL depth to field an XI) with
 * the real WC 2026 field. The PICKABLE set = playable ∩ WC2026 — the nations a user
 * can actually run a World Cup with. Also lists WC nations that just miss the cut.
 *
 * Run after build-dataset.mjs: node scripts/draft/validate-wc.mjs
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(__dirname, "..", "..", "src", "data", "draft", "player-seasons.json"), "utf8"));

// The 48 WC 2026 nations (must match the canonical names in src/data/draft/wc2026.ts).
const WC = new Set([
  "Czechia", "Mexico", "South Africa", "South Korea",
  "Bosnia-Herzegovina", "Canada", "Qatar", "Switzerland",
  "Brazil", "Haiti", "Morocco", "Scotland",
  "Australia", "Paraguay", "Türkiye", "United States",
  "Curaçao", "Ecuador", "Germany", "Ivory Coast",
  "Japan", "Netherlands", "Sweden", "Tunisia",
  "Belgium", "Egypt", "Iran", "New Zealand",
  "Cape Verde", "Saudi Arabia", "Spain", "Uruguay",
  "France", "Iraq", "Norway", "Senegal",
  "Algeria", "Argentina", "Austria", "Jordan",
  "Colombia", "Congo DR", "Portugal", "Uzbekistan",
  "Croatia", "England", "Ghana", "Panama",
]);

const nations = data.nations || [];
const byName = new Map(nations.map((n) => [n.nation, n]));
const playable = nations.filter((n) => n.playable);
const pickable = playable.filter((n) => WC.has(n.nation)).sort((a, b) => b.count - a.count);

console.log(`Pool: ${data.counts.players} player-seasons, ${data.counts.missingNationality} missing nationality.`);
console.log(`Playable nations: ${playable.length}. In WC 2026 field: ${pickable.length} (the PICKABLE set).\n`);

console.log(`PICKABLE for World Cup Run (${pickable.length}):`);
for (const n of pickable) console.log(`  ${n.nation.padEnd(16)} GK${n.lines.GK} DEF${n.lines.DEF} MID${n.lines.MID} ATT${n.lines.ATT}  (${n.count})`);

const wcMissing = [...WC].map((w) => byName.get(w)).filter((n) => n && !n.playable);
console.log(`\nWC nations that JUST miss the cut (have some PL depth):`);
for (const n of wcMissing.sort((a, b) => b.count - a.count)) {
  const need = [];
  if (n.lines.GK < 1) need.push("GK"); if (n.lines.DEF < 5) need.push("DEF");
  if (n.lines.MID < 4) need.push("MID"); if (n.lines.ATT < 3) need.push("ATT");
  console.log(`  ${n.nation.padEnd(16)} GK${n.lines.GK} DEF${n.lines.DEF} MID${n.lines.MID} ATT${n.lines.ATT}  short: ${need.join(",")}`);
}

const wcNone = [...WC].filter((w) => !byName.has(w));
console.log(`\nWC nations with NO PL players in pool (${wcNone.length}): ${wcNone.join(", ")}`);
