#!/usr/bin/env node
/**
 * demo.mjs — boot the app against the stub DB with a fake Saturday seeded, so a
 * human can SEE the feature in a browser without waiting for 21 August.
 *
 * Three fixtures, three states:
 *   Arsenal v Chelsea      — AT HALFTIME, pack LIVE (released via the real route)
 *   Liverpool v Man City   — in play, pack drops at half time
 *   Newcastle v Spurs      — kicks off later today
 *
 * Nothing touches real Supabase or SportMonks: same seams as replay-test.mjs.
 *
 *   node scripts/halftime/demo.mjs        # app on :3401, Ctrl-C to stop
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const STUB_PORT = 8790;
const APP_PORT = 3401;
const STUB = `http://127.0.0.1:${STUB_PORT}`;
const APP = `http://127.0.0.1:${APP_PORT}`;
const SECRET = "demo-secret";

const children = new Set();
function start(cmd, args, opts = {}) {
  const child = spawn(cmd, args, {
    cwd: REPO, stdio: ["ignore", "inherit", "inherit"], detached: true, ...opts,
  });
  children.add(child);
  child.on("exit", () => children.delete(child));
  return child;
}
function killAll() {
  for (const c of children) {
    try { process.kill(-c.pid, "SIGKILL"); } catch { try { c.kill("SIGKILL"); } catch { /* gone */ } }
  }
}
process.on("exit", killAll);
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => { killAll(); process.exit(130); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(url, ms = 60000) {
  const until = Date.now() + ms;
  for (;;) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* not yet */ }
    if (Date.now() > until) throw new Error(`timed out waiting for ${url}`);
    await sleep(300);
  }
}

const stubHeaders = {
  "content-type": "application/json",
  apikey: "stub-service-role-key",
  authorization: "Bearer stub-service-role-key",
  prefer: "return=representation",
};
async function insert(table, row) {
  const res = await fetch(`${STUB}/rest/v1/${table}`, {
    method: "POST", headers: stubHeaders, body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`insert ${table} → ${res.status}: ${await res.text()}`);
}

/** 10 valid questions, correct answer authored as A (shuffle happens at release-copy). */
const pack = (home, away) => [
  [`Which club has won more league titles overall — ${home} or ${away}?`, "It has swung through history", "easy"],
  [`${home} and ${away} first met in which competition?`, "The First Division", "medium"],
  [`Who is ${home}'s all-time record appearance holder?`, "A one-club legend", "medium"],
  [`Which player has scored the most goals in this fixture's history?`, "A striker of the 2000s", "hard"],
  [`What was the score the last time ${away} won away in this fixture?`, "A narrow one", "medium"],
  [`Which manager has taken charge of BOTH ${home} and ${away}?`, "It has happened once", "hard"],
  [`In which decade did this fixture first take place?`, "Earlier than most guess", "easy"],
  [`Which stadium hosted this fixture before ${home}'s current ground?`, "The old place", "medium"],
  [`Who scored the fastest goal ever recorded in this fixture?`, "Inside a minute", "hard"],
  [`How many times has this fixture ended 0-0 in the Premier League era?`, "Fewer than ten", "easy"],
].map(([q, note, difficulty], i) => ({
  question: q,
  options: { A: `${note} (correct)`, B: "Not this one", C: "Nor this", D: "Nor this either" },
  answer: "A",
  difficulty,
  demo: true,
  n: i + 1,
}));

const iso = (minsFromNow) => new Date(Date.now() + minsFromNow * 60_000).toISOString();
const FIXTURES = [
  { fixture_id: 900001, home: "Arsenal", away: "Chelsea", kickoff_at: iso(-47), state: "staged", release: true },
  { fixture_id: 900002, home: "Liverpool", away: "Man City", kickoff_at: iso(-20), state: "staged", release: false },
  { fixture_id: 900003, home: "Newcastle", away: "Spurs", kickoff_at: iso(120), state: "base_ready", release: false },
];

console.log(`\nDEMO — stub :${STUB_PORT}, app :${APP_PORT}\n`);

start(process.execPath, [join(HERE, "stub-supabase.mjs"), "--port", String(STUB_PORT)]);
await waitFor(`${STUB}/rest/v1/halftime_releases`);

for (const f of FIXTURES) {
  const qs = pack(f.home, f.away);
  await insert("halftime_releases", {
    id: crypto.randomUUID(),
    fixture_id: f.fixture_id,
    season_id: 28083,
    round_name: "1",
    pack_id: f.state === "staged" ? crypto.randomUUID() : null,
    home: f.home,
    away: f.away,
    kickoff_at: f.kickoff_at,
    state: f.state,
    base_questions: qs,
    fresh_questions: [],
    pack_questions: f.state === "staged" ? qs : null,
    fresh_state: "skipped",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  console.log(`seeded ${f.home} v ${f.away} (${f.state})`);
}

start("npx", ["next", "dev", "-p", String(APP_PORT)], {
  stdio: ["ignore", "ignore", "ignore"],
  env: {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: STUB,
    SUPABASE_SERVICE_ROLE_KEY: "stub-service-role-key",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "stub-anon-key",
    SPORTMONKS_BASE_URL: STUB, // never called in the demo, but never real either
    SPORTMONKS_API_KEY: "demo-key",
    CRON_SECRET: SECRET,
    HALFTIME_PUSH_ENABLED: "false",
    NEXT_TELEMETRY_DISABLED: "1",
  },
});
await waitFor(`${APP}/api/halftime/today`, 120000);

// Release Arsenal v Chelsea through the REAL route — the app inserts the
// quiz_packs row and flips the state exactly as it would at a live whistle.
for (const f of FIXTURES.filter((x) => x.release)) {
  const res = await fetch(`${APP}/api/halftime/release`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
    body: JSON.stringify({ fixtureId: f.fixture_id }),
  });
  console.log(`released ${f.home} v ${f.away} → ${res.status} ${JSON.stringify(await res.json())}`);
}

const today = await (await fetch(`${APP}/api/halftime/today`)).json();
console.log(`\n/api/halftime/today →`, JSON.stringify(today, null, 1));
console.log(`\nOPEN:  ${APP}/play   (the Halftime rail)`);
console.log(`       ${APP}/        (the Home card)`);
console.log(`\nCtrl-C to stop.\n`);
await new Promise(() => {});
