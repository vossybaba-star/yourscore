// Balance measurements over the REAL game code (see measure.sh). Two studies:
//   A) 26/27 economy: what does "max every deal" actually cost across many
//      seeded runs, and what does a player really afford at 8/11 and 11/11?
//   B) Season sim: P(38-0) and P(champions) by XI strength, via the actual
//      simulateSeason engine against the actual opponent list.

const base = new URL("../../.tmp-measure/lib/", import.meta.url);
const { grantFor, priceOf } = await import(new URL("gates/warmup-economy.js", base));
const { dealCurrentSquad } = await import(new URL("gates/warmup-deals.js", base));
const { scoreTeam, seededRng } = await import(new URL("draft/score.js", base));
const { slotsFor } = await import(new URL("draft/formations.js", base));
const { simulateSeason } = await import(new URL("draft/season.js", base));
const { ensurePool, leagueOpponents } = await import(new URL("draft/pool.js", base));

import { readFileSync } from "node:fs";
const pool = JSON.parse(readFileSync(new URL("../../src/data/gates/pool.json", import.meta.url), "utf8"));
const currentPlayers = pool.currentPlayers;
const slots = slotsFor("4-3-3");

const stats = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { min: s[0], p25: q(0.25), med: q(0.5), p75: q(0.75), max: s[s.length - 1], avg: xs.reduce((a, b) => a + b, 0) / xs.length };
};
const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);

// ── Study A: 26/27 economy ────────────────────────────────────────────────────
function playRun(seedKey, correctSlots, unlimited) {
  // correctSlots: Set of slot indices answered correctly.
  let budget = 0;
  let streak = 0;
  const usedIds = new Set();
  const usedIdents = new Set();
  const placed = [];
  let dealMaxAffordable = 0;
  let spent = 0;
  for (let k = 0; k < slots.length; k++) {
    const correct = correctSlots.has(k);
    streak = correct ? streak + 1 : 0;
    budget += grantFor(correct, streak);
    const wallet = unlimited ? 1e9 : budget;
    const squad = dealCurrentSquad(currentPlayers, slots[k].pos, usedIds, usedIdents, wallet, `${seedKey}:deal:${k}`);
    if (!squad.players.length) continue;
    // greedy: most expensive affordable; stretch-buy cheapest if none.
    const priced = squad.players.map((p) => ({ p, price: priceOf(p.overall) }));
    const affordable = priced.filter((x) => x.price <= wallet);
    const isMaxAffordable = priced[0].price <= wallet;
    if (isMaxAffordable) dealMaxAffordable++;
    const pick = affordable.length ? affordable[0] : { p: priced[priced.length - 1].p, price: budget };
    const cost = unlimited ? pick.price : Math.min(pick.price, budget);
    budget -= cost;
    spent += cost;
    usedIds.add(pick.p.id);
    placed.push({ slot: slots[k].id, slotPos: slots[k].pos, player_season_id: pick.p.id, name: pick.p.name, club: pick.p.club, season: pick.p.season, overall: pick.p.overall, position: pick.p.position });
  }
  const strength = placed.length === 11 ? scoreTeam(placed, "4-3-3") : 0;
  return { leftover: budget, spent, strength, dealMaxAffordable };
}

function correctSet(n, seed) {
  // n correct answers at seeded-random positions.
  const rng = seededRng(`${seed}:correct`);
  const idx = [...Array(11).keys()];
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  return new Set(idx.slice(0, n));
}

const N = 400;
const runsUnlimited = [];
const runs8 = [];
const runs11 = [];
for (let i = 0; i < N; i++) {
  runsUnlimited.push(playRun(`u${i}`, correctSet(11, `u${i}`), true));
  runs8.push(playRun(`e${i}`, correctSet(8, `e${i}`), false));
  runs11.push(playRun(`p${i}`, correctSet(11, `p${i}`), false));
}
console.log(`\n=== STUDY A · 26/27 economy (${N} seeded runs each) ===`);
const maxCost = stats(runsUnlimited.map((r) => r.spent));
const maxStr = stats(runsUnlimited.map((r) => r.strength));
console.log(`Cost to buy the BEST player in every deal (unlimited money):`);
console.log(`  £${f1(maxCost.min)}–£${f1(maxCost.max)}m, median £${f1(maxCost.med)}m (p25 £${f1(maxCost.p25)} · p75 £${f1(maxCost.p75)})`);
console.log(`  XI strength if you max everything: median ${f1(maxStr.med)} (max ${f1(maxStr.max)})`);
for (const [label, runs, earnedN] of [["8/11 correct", runs8, 8], ["11/11 correct", runs11, 11]]) {
  const left = stats(runs.map((r) => r.leftover));
  const str = stats(runs.map((r) => r.strength));
  const maxable = stats(runs.map((r) => r.dealMaxAffordable));
  console.log(`${label} (greedy buyer):`);
  console.log(`  leftover: median £${f1(left.med)}m (p25 £${f1(left.p25)} · p75 £${f1(left.p75)} · max £${f1(left.max)})`);
  console.log(`  deals where the top player was affordable: median ${maxable.med}/11`);
  console.log(`  XI strength: median ${f1(str.med)} (p75 ${f1(str.p75)}, max ${f1(str.max)})`);
}

// ── Study B: season sim odds by strength ─────────────────────────────────────
await ensurePool();
const opponents = leagueOpponents("PL");
console.log(`\n=== STUDY B · season sim (real engine, ${opponents.length} opponents str ${Math.min(...opponents.map(o=>o.strength))}–${Math.max(...opponents.map(o=>o.strength))}) ===`);
console.log("uniform XI rating → strength → outcomes over 3000 seasons:");
const SIMS = 3000;
for (const ov of [76, 78, 80, 82, 84, 86, 88, 90, 92, 93]) {
  const squad = slots.map((s) => ({ slot: s.id, slotPos: s.pos, player_season_id: `syn-${s.id}`, name: `P${s.id}`, club: "SYN", season: "x", overall: ov, position: s.pos }));
  const strength = scoreTeam(squad, "4-3-3");
  let inv = 0, champ = 0, winsSum = 0;
  for (let i = 0; i < SIMS; i++) {
    const r = simulateSeason(squad, "4-3-3", strength, `sim:${ov}:${i}`, opponents);
    if (r.invincible) inv++;
    if (r.position === 1) champ++;
    winsSum += r.wins;
  }
  console.log(`  ov ${ov} → str ${f1(strength)}: champions ${(100 * champ / SIMS).toFixed(1)}% · 38-0 ${(100 * inv / SIMS).toFixed(2)}% · avg wins ${(winsSum / SIMS).toFixed(1)}`);
}
console.log("\ndone.");
