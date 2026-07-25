/**
 * Refresh display names in the existing fantasy pool — names only, nothing else.
 *
 * Naming is the one field that changes without the squad changing, and a full
 * build-pool run needs the SportMonks API (and re-derives every smId). This
 * rewrites `name` in place from the FPL bootstrap using the shared rule, leaving
 * the baked smIds — the thing that makes players scorable — untouched.
 *
 *   node scripts/fantasy/refresh-names.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { displayName, assertNames } from "../lib/player-name.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const poolPath = join(root, "src/data/fantasy/pool.json");

const pool = JSON.parse(readFileSync(poolPath, "utf8"));
const boot = JSON.parse(readFileSync(join(root, "scripts/data/fpl-bootstrap-cache.json"), "utf8"));
const byId = new Map(boot.elements.map((e) => [e.id, e]));

let changed = 0;
const missing = [];
const before = new Map(pool.players.map((p) => [p.id, p.name]));

for (const p of pool.players) {
  const e = byId.get(p.id);
  if (!e) { missing.push(p.name); continue; }
  const next = displayName(e);
  if (next && next !== p.name) { p.name = next; changed++; }
}

// Same guard the builder runs: no bare surnames, no leftover abbreviations.
assertNames(pool.players.map((p) => ({
  name: p.name, club: p.club, minutes: byId.get(p.id)?.minutes ?? 0,
})));

if (missing.length) console.warn(`⚠ ${missing.length} pool players not in the FPL cache (names left as-is): ${missing.slice(0, 5).join(", ")}`);

writeFileSync(poolPath, JSON.stringify(pool));
console.log(`✅ ${changed} of ${pool.players.length} names updated`);
for (const p of pool.players) {
  const was = before.get(p.id);
  if (was !== p.name) console.log(`   ${String(was).padEnd(24)} → ${p.name}`);
}
