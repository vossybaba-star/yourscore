#!/usr/bin/env node
/**
 * record-states.mjs — pull the LIVE SportMonks states catalogue and commit it.
 *
 * The replay server serves this file verbatim. Scenarios name states by
 * developer_name and the production code resolves them the same way, so a
 * committed real catalogue is what stops the whole test suite from being
 * circular: if I invented the ids, a scenario would prove only that my
 * invention agrees with itself.
 *
 * It also re-verifies, first-hand, the one id the production code hardcodes:
 * half time is state_id 3.
 *
 *   node --env-file=.env.local scripts/halftime/record-states.mjs
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "scenarios", "states.json");

const key = process.env.SPORTMONKS_API_KEY;
if (!key) {
  console.error("✗ SPORTMONKS_API_KEY not set (use --env-file=.env.local)");
  process.exit(1);
}

const base = process.env.SPORTMONKS_BASE_URL || "https://api.sportmonks.com";
const res = await fetch(`${base}/v3/football/states`, {
  headers: { Authorization: key, Accept: "application/json" },
});

if (!res.ok) {
  console.error(`✗ GET /v3/football/states → ${res.status}`);
  process.exit(1);
}

const body = await res.json();
const states = (body.data ?? []).map((s) => ({
  id: Number(s.id),
  state: s.state,
  name: s.name,
  short_name: s.short_name ?? null,
  developer_name: s.developer_name,
}));

if (!states.length) {
  console.error("✗ empty states catalogue");
  process.exit(1);
}

const ht = states.find((s) => s.developer_name === "HT");
if (!ht) {
  console.error("✗ no HT state in the catalogue");
  process.exit(1);
}

writeFileSync(OUT, `${JSON.stringify(states, null, 2)}\n`);

console.log(`✓ ${states.length} states → ${OUT}`);
console.log(`✓ HT is state_id ${ht.id} ${ht.id === 3 ? "(matches HALFTIME_STATE_ID)" : "✗✗ CODE SAYS 3 ✗✗"}`);
if (ht.id !== 3) process.exit(2);

for (const s of states) console.log(`  ${String(s.id).padStart(3)}  ${s.developer_name}`);
