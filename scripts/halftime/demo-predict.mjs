#!/usr/bin/env node
/**
 * demo-predict.mjs — exercise the halftime prediction poll's SERVER path end to
 * end against the stub DB, no August required.
 *
 * It proves the parts that carry real risk — the schema, the service-role tally,
 * and the "poll closed once settled" flag — by driving the actual
 * /api/halftime/predict route:
 *   1. an OPEN fixture with 100 fan picks seeded → GET returns the right tally.
 *   2. a SETTLED fixture (result row seeded) → GET returns closed:true + result.
 *
 * The authenticated POST (a fan casting a pick) is not exercised here: the stub
 * has no auth server, so getUser() can't return a user. That path is covered by
 * the real `next build` (types + the route) and the shared server-auth pattern
 * it copies from /api/quiz/solo-complete, and it is verified live on 2026-08-21.
 *
 *   node scripts/halftime/demo-predict.mjs      (app :3403, stub :8792)
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const STUB_PORT = 8792;
const APP_PORT = 3403;
const STUB = `http://127.0.0.1:${STUB_PORT}`;
const APP = `http://127.0.0.1:${APP_PORT}`;

const OPEN_FIX = 930001;
const SETTLED_FIX = 930002;
const OPEN_PACK = "aaaaaaaa-0000-4000-8000-000000000001";
const SETTLED_PACK = "aaaaaaaa-0000-4000-8000-000000000002";

const children = new Set();
function start(cmd, args, opts = {}) {
  const child = spawn(cmd, args, { cwd: REPO, stdio: ["ignore", "inherit", "inherit"], detached: true, ...opts });
  children.add(child);
  child.on("exit", () => children.delete(child));
  return child;
}
function killAll() {
  for (const c of children) { try { process.kill(-c.pid, "SIGKILL"); } catch { try { c.kill("SIGKILL"); } catch { /* gone */ } } }
}
process.on("exit", killAll);
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => { killAll(); process.exit(130); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(url, ms = 180000) {
  const until = Date.now() + ms;
  for (;;) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* not yet */ }
    if (Date.now() > until) throw new Error(`timed out waiting for ${url}`);
    await sleep(300);
  }
}
async function seed(table, rows) {
  const res = await fetch(`${STUB}/_stub/seed`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ table, rows }),
  });
  if (!res.ok) throw new Error(`seed ${table} → ${res.status}: ${await res.text()}`);
}
const uuid = () => crypto.randomUUID();
const iso = (minsAgo) => new Date(Date.now() - minsAgo * 60_000).toISOString();

function htPack(id, fixtureId, home, away) {
  return {
    id, name: `Halftime: ${home} v ${away}`, type: "records", parameter: String(fixtureId),
    source: "system", status: "published", rotation_active: true, featured: false,
    question_count: 10, questions: [],
    metadata: { halftime: { fixture_id: fixtureId, matchday: "2026-08-21", kickoff_at: iso(70), home, away } },
  };
}
function picks(fixtureId, packId, counts) {
  const rows = [];
  for (const [pick, n] of Object.entries(counts)) {
    for (let i = 0; i < n; i++) {
      rows.push({ user_id: uuid(), fixture_id: fixtureId, pack_id: packId, pick, correct: null, created_at: iso(20) });
    }
  }
  return rows;
}

console.log(`\nPREDICT DEMO — stub :${STUB_PORT}, app :${APP_PORT}\n`);
start(process.execPath, [join(HERE, "stub-supabase.mjs"), "--port", String(STUB_PORT)]);
await waitFor(`${STUB}/rest/v1/quiz_packs`);

const OPEN_COUNTS = { home: 62, draw: 21, away: 17 };
const SETTLED_COUNTS = { home: 40, draw: 43, away: 17 };

await seed("quiz_packs", [htPack(OPEN_PACK, OPEN_FIX, "Arsenal", "Chelsea"), htPack(SETTLED_PACK, SETTLED_FIX, "Spurs", "Everton")]);
await seed("halftime_predictions", [...picks(OPEN_FIX, OPEN_PACK, OPEN_COUNTS), ...picks(SETTLED_FIX, SETTLED_PACK, SETTLED_COUNTS)]);
// The settled fixture already has a result row → the poll is closed, GET says so.
await seed("halftime_prediction_results", [
  { fixture_id: SETTLED_FIX, home_goals: 1, away_goals: 1, result: "draw", settled_at: iso(1) },
]);
console.log("seeded 2 halftime packs, 200 picks, 1 settled result");

start("npx", ["next", "dev", "-p", String(APP_PORT)], {
  stdio: ["ignore", "ignore", "ignore"],
  env: {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: STUB, SUPABASE_SERVICE_ROLE_KEY: "stub-service-role-key",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "stub-anon-key", CRON_SECRET: "demo-secret",
    SPORTMONKS_BASE_URL: STUB, SPORTMONKS_API_KEY: "demo-key", NEXT_TELEMETRY_DISABLED: "1",
  },
});
await waitFor(`${APP}/api/halftime/predict?pack=${OPEN_PACK}`, 180000);

let fails = 0;
const check = (name, cond, got) => { console.log(`  ${cond ? "✓" : "✗"} ${name}${cond ? "" : `  — got ${JSON.stringify(got)}`}`); if (!cond) fails++; };

const open = await (await fetch(`${APP}/api/halftime/predict?pack=${OPEN_PACK}`)).json();
console.log(`\n=== OPEN fixture (Arsenal v Chelsea) ===`);
check("home tally = 62", open.tally?.home === 62, open.tally);
check("draw tally = 21", open.tally?.draw === 21, open.tally);
check("away tally = 17", open.tally?.away === 17, open.tally);
check("total = 100", open.tally?.total === 100, open.tally);
check("poll open (closed:false)", open.closed === false, open.closed);
check("no result yet", open.result === null, open.result);
check("guest has no pick", open.myPick === null, open.myPick);

const settled = await (await fetch(`${APP}/api/halftime/predict?pack=${SETTLED_PACK}`)).json();
console.log(`\n=== SETTLED fixture (Spurs v Everton, ended level) ===`);
check("poll closed (closed:true)", settled.closed === true, settled.closed);
check("result = draw", settled.result === "draw", settled.result);
check("tally still readable", settled.tally?.total === 100, settled.tally);

const notHt = await fetch(`${APP}/api/halftime/predict?pack=${uuid()}`);
console.log(`\n=== non-halftime / unknown pack ===`);
check("unknown pack → 404", notHt.status === 404, notHt.status);

console.log(fails ? `\n✗ ${fails} check(s) failed\n` : `\n✓ all checks passed\n`);
killAll();
process.exit(fails ? 1 : 0);
