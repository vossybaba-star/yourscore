#!/usr/bin/env node
/**
 * REPLAY STUB — stands in for scripts/halftime/gen-fresh.mjs.
 *
 * The real one mines a dossier from the confirmed XIs and asks an LLM to write
 * three questions from it. That is exactly what a test must NOT do: it would
 * cost money on every run, hit the live API, and give a different answer each
 * time — so a red would never mean the same thing twice.
 *
 * This produces the same SHAPE, deterministically, from the replay server's
 * lineups, and persists it through the same route (POST /api/halftime/fresh,
 * op=fresh) the real one uses. What the harness is testing is the POLLER's
 * orchestration of the pipeline — when it runs, what it does with the result,
 * how it degrades — not the LLM's prose.
 *
 * Contract (spec §5): `gen-fresh.mjs --fixture <id>`
 *   exit 0 = fresh slice persisted, or legitimately skipped (an empty slice is
 *            a normal outcome, not a failure)
 *   exit 2 = bounded failure
 *
 * Reached only via HALFTIME_GEN_DIR, which production never sets.
 */

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };

const fixtureId = Number(opt("--fixture"));
if (!Number.isInteger(fixtureId)) {
  console.error("usage: gen-fresh.mjs --fixture <id>");
  process.exit(2);
}

const API = (process.env.HALFTIME_API_BASE || "").replace(/\/$/, "");
const SM = (process.env.SPORTMONKS_BASE_URL || "").replace(/\/$/, "");
const SECRET = process.env.CRON_SECRET;
const KEY = process.env.SPORTMONKS_API_KEY;

// Deliberate failure injection, so the "the gate could not be offered" path
// (fresh slice DROPPED, never auto-released) is a thing the suite can actually
// reach rather than a paragraph in a design doc.
const FAIL = process.env.HALFTIME_REPLAY_GEN_FAIL === "1";
if (FAIL) {
  console.error("stub gen-fresh: simulated bounded failure");
  process.exit(2);
}

// The fact miner's input: the confirmed XI, from the replay server.
const res = await fetch(`${SM}/v3/football/fixtures/${fixtureId}?include=lineups;participants`, {
  headers: { Authorization: KEY },
});
if (!res.ok) { console.error(`stub gen-fresh: sportmonks ${res.status}`); process.exit(2); }

const fixture = (await res.json()).data;
const starters = (fixture.lineups ?? []).filter((l) => Number(l.type_id) === 11);

// No sheets → no dossier → no questions. Exit 0: this is a normal outcome.
if (starters.length < 22) {
  console.log(`stub gen-fresh: only ${starters.length} starters — nothing to mine, base-only`);
  process.exit(0);
}

// Three "reveals", each carrying a machine-checkable claim, exactly as the real
// validator expects. The claims point at players who really are in the lineup
// the replay server is serving, so validate.mjs would resolve them.
const picked = [starters[0], starters[5], starters[11]];
const questions = picked.map((p, i) => ({
  question: `FRESH ${i + 1}: Which player starts today wearing number ${p.jersey_number}?`,
  options: {
    A: p.player_name,
    B: starters[(i + 3) % starters.length].player_name,
    C: starters[(i + 7) % starters.length].player_name,
    D: starters[(i + 13) % starters.length].player_name,
  },
  answer: "A",
  difficulty: "medium",
  status: "pending",
  fact: `${p.player_name} is named in the confirmed XI at number ${p.jersey_number}.`,
  claims: [{ type: "player_in_lineup", player_id: p.player_id, team_id: p.team_id }],
}));

const persist = await fetch(`${API}/api/halftime/fresh`, {
  method: "POST",
  headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
  body: JSON.stringify({ op: "fresh", fixtureId, questions, state: "pending_veto" }),
});

if (!persist.ok) {
  console.error(`stub gen-fresh: persist failed ${persist.status} ${await persist.text()}`);
  process.exit(2);
}

console.log(`stub gen-fresh: ${questions.length} fresh question(s) persisted for ${fixtureId}`);
process.exit(0);
