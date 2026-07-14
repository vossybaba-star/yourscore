#!/usr/bin/env node
/**
 * demo-clubs.mjs — see the club-fan leaderboard without waiting for August.
 *
 * Boots the app against the stub DB with a full gameweek seeded:
 *   - 10 released halftime packs (GW1)
 *   - ~250 fans across the 20 clubs, each declared to a club
 *   - halftime attempts with DELIBERATELY rigged distributions, to prove the
 *     product rule on screen: Brentford has 8 sharp fans (avg ~9,200) and
 *     Man United has 60 casual ones (avg ~3,100). United's TOTAL dwarfs
 *     Brentford's. Brentford still wins, because the table ranks by AVERAGE.
 *   - Nottingham Forest gets only 4 fans → below the 5-fan minimum → listed as
 *     "not enough players", never ranked.
 *
 * The signed-in viewer is a Spurs fan, so you can see the "your club" highlight.
 * Run:  node scripts/halftime/demo-clubs.mjs     (app on :3402, Ctrl-C to stop)
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const STUB_PORT = 8791;
const APP_PORT = 3402;
const STUB = `http://127.0.0.1:${STUB_PORT}`;
const APP = `http://127.0.0.1:${APP_PORT}`;
const SEASON = 28083;
const GW = "1";

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
async function waitFor(url, ms = 120000) {
  const until = Date.now() + ms;
  for (;;) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* not yet */ }
    if (Date.now() > until) throw new Error(`timed out waiting for ${url}`);
    await sleep(300);
  }
}
async function seed(table, rows) {
  const res = await fetch(`${STUB}/_stub/seed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ table, rows }),
  });
  if (!res.ok) throw new Error(`seed ${table} → ${res.status}: ${await res.text()}`);
}

// ── the fixtures (GW1) ───────────────────────────────────────────────────────
const FIXTURES = [
  ["Arsenal", "Chelsea"], ["Liverpool", "Man City"], ["Man United", "Everton"],
  ["Spurs", "Brentford"], ["Newcastle", "Aston Villa"], ["Brighton", "West Ham"],
  ["Crystal Palace", "Fulham"], ["Wolves", "Bournemouth"],
  ["Nottingham Forest", "Leeds"], ["Burnley", "Sunderland"],
];

/**
 * fans + the average score each club's fans post. Rigged to make the design
 * argument visible: Brentford few-and-sharp; Man United many-and-casual.
 */
const CLUB_FANS = {
  "Brentford": [8, 9200],          // ← few, sharp. Should WIN.
  "Brighton": [11, 8400],
  "Crystal Palace": [9, 7900],
  "Arsenal": [42, 6100],
  "Spurs": [31, 5600],             // ← the viewer's club
  "Liverpool": [38, 5400],
  "Newcastle": [17, 5100],
  "Aston Villa": [14, 4800],
  "Chelsea": [29, 4500],
  "Man City": [26, 4300],
  "West Ham": [12, 4000],
  "Everton": [13, 3800],
  "Wolves": [7, 3500],
  "Fulham": [6, 3300],
  "Man United": [60, 3100],        // ← many, casual. Biggest TOTAL, low average.
  "Bournemouth": [5, 2900],
  "Leeds": [6, 2600],
  "Burnley": [5, 2300],
  "Sunderland": [5, 2100],
  "Nottingham Forest": [4, 9900],  // ← only 4 fans: below the min-5 bar. Unranked
};                                 //    even though they'd have topped the table.

const iso = (mins) => new Date(Date.now() + mins * 60_000).toISOString();
const uuid = () => crypto.randomUUID();

/**
 * How long ago the gameweek's first match kicked off. Default 260 minutes puts
 * every fixture comfortably past the cron's 135-minute settle window, so the
 * end-of-gameweek result push is due. Pass --live to bring them to ~2h ago
 * instead, which is INSIDE the window — the cron then correctly reports
 * {idle:true} and sends nothing, because a match might still be being played.
 */
const KO_MINS_AGO = process.argv.includes("--live") ? 120 : 260;

console.log(`\nCLUB DEMO — stub :${STUB_PORT}, app :${APP_PORT}\n`);

start(process.execPath, [join(HERE, "stub-supabase.mjs"), "--port", String(STUB_PORT)]);
await waitFor(`${STUB}/rest/v1/halftime_releases`);

// 1. released halftime packs, one per fixture
const packIds = {};
const releases = [];
const packs = [];
FIXTURES.forEach(([home, away], i) => {
  const packId = uuid();
  packIds[`${home}|${away}`] = packId;
  releases.push({
    id: uuid(), fixture_id: 910000 + i, season_id: SEASON, round_name: GW,
    pack_id: packId, home, away, kickoff_at: iso(-KO_MINS_AGO + i),
    state: "released", released_at: iso(-KO_MINS_AGO + 50 + i),
    base_questions: [], fresh_questions: [], pack_questions: [],
    fresh_state: "skipped", created_at: iso(-200), updated_at: iso(-70),
  });
  packs.push({
    id: packId, name: `Halftime: ${home} v ${away}`, type: "records",
    parameter: String(910000 + i), source: "system", status: "published",
    rotation_active: true, featured: false, question_count: 10, questions: [],
  });
});
await seed("halftime_releases", releases);
await seed("quiz_packs", packs);
console.log(`seeded ${releases.length} released halftime packs (GW${GW})`);

// 2. fans, their declarations, and their halftime scores
const VIEWER = "11111111-1111-4111-8111-111111111111"; // signed-in Spurs fan
const profiles = [];
const supporters = [];
const attempts = [];
const allPackIds = Object.values(packIds);
let n = 0;

for (const [club, [fanCount, avg]] of Object.entries(CLUB_FANS)) {
  for (let f = 0; f < fanCount; f++) {
    const isViewer = club === "Spurs" && f === 0;
    const userId = isViewer ? VIEWER : uuid();
    // opted in, so the end-of-gameweek result push has someone to send to.
    profiles.push({
      id: userId,
      username: `${club.toLowerCase().replace(/\W/g, "")}_fan${f + 1}`,
      notifications_opt_in: true,
    });
    supporters.push({ user_id: userId, club, season_id: SEASON, created_at: iso(-500) });
    // spread scores ±25% around the club's average, deterministic-ish
    const jitter = 1 + (((n * 37) % 50) - 25) / 100;
    attempts.push({
      id: uuid(), user_id: userId,
      pack_id: allPackIds[n % allPackIds.length],
      score: Math.round(avg * jitter), max_score: 12000,
      correct_count: 7, answers: [], completed_at: iso(-60),
    });
    n++;
  }
}
await seed("profiles", profiles);
await seed("club_supporters", supporters);
await seed("quiz_attempts", attempts);
console.log(`seeded ${profiles.length} fans across ${Object.keys(CLUB_FANS).length} clubs, ${attempts.length} halftime attempts`);

// 3. boot the app
start("npx", ["next", "dev", "-p", String(APP_PORT)], {
  stdio: ["ignore", "ignore", "ignore"],
  env: {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: STUB,
    SUPABASE_SERVICE_ROLE_KEY: "stub-service-role-key",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "stub-anon-key",
    SPORTMONKS_BASE_URL: STUB,
    SPORTMONKS_API_KEY: "demo-key",
    CRON_SECRET: "demo-secret",
    HALFTIME_PUSH_ENABLED: "false",
    NEXT_TELEMETRY_DISABLED: "1",
  },
});
await waitFor(`${APP}/api/clubs/table`, 180000);

const table = await (await fetch(`${APP}/api/clubs/table`)).json();
const rows = table.standings ?? [];
console.log(`\n=== GW${GW} CLUB TABLE (the product rule, computed by the real code) ===`);
for (const r of rows.filter((x) => x.eligible)) {
  console.log(
    `  ${String(r.rank).padStart(2)}. ${r.club.padEnd(18)} avg ${String(Math.round(r.avgScore)).padStart(6)}` +
      `  · ${String(r.participants).padStart(2)} fans · total ${String(r.totalScore).padStart(7)}`,
  );
}
for (const r of rows.filter((x) => !x.eligible)) {
  console.log(`   —  ${r.club.padEnd(18)} not enough players (${r.participants} fan(s))`);
}
console.log(`\nOPEN:  ${APP}/play\n\nCtrl-C to stop.\n`);
await new Promise(() => {});
