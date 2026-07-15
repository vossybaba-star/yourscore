#!/usr/bin/env node
/**
 * demo-matchweek.mjs — see the whole Matchweek hub with real-shaped data:
 *   PL → News       real RSS football headlines (via scripts/pl-news-ingest.mjs)
 *   Live Quiz       the club-fan leaderboard (GW1, seeded) + the upcoming
 *                   gameweek/quiz schedule (GW2 & GW3, future fixtures)
 *
 * GW1 sits in the past with attempts → the leaderboard has a completed gameweek
 * to rank. GW2/GW3 are future → the schedule has gameweeks to list. News is
 * pulled live from BBC + Guardian, so it's genuinely current.
 *
 * Run:  node scripts/halftime/demo-matchweek.mjs   (app on :3404, Ctrl-C to stop)
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const STUB_PORT = 8793;
const APP_PORT = 3404;
const STUB = `http://127.0.0.1:${STUB_PORT}`;
const APP = `http://127.0.0.1:${APP_PORT}`;
const SEASON = 28083;

const children = new Set();
function start(cmd, args, opts = {}) {
  const child = spawn(cmd, args, { cwd: REPO, stdio: ["ignore", "inherit", "inherit"], detached: true, ...opts });
  children.add(child); child.on("exit", () => children.delete(child)); return child;
}
function run(cmd, args, env) {
  return new Promise((res, rej) => {
    const c = spawn(cmd, args, { cwd: REPO, stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, ...env } });
    c.on("exit", (code) => (code === 0 ? res() : rej(new Error(`${cmd} exited ${code}`))));
  });
}
function killAll() { for (const c of children) { try { process.kill(-c.pid, "SIGKILL"); } catch { try { c.kill("SIGKILL"); } catch { /* gone */ } } } }
process.on("exit", killAll);
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => { killAll(); process.exit(130); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(url, ms = 180000) {
  const until = Date.now() + ms;
  for (;;) { try { if ((await fetch(url)).status < 500) return; } catch { /* not yet */ } if (Date.now() > until) throw new Error(`timed out: ${url}`); await sleep(300); }
}
async function seed(table, rows) {
  const res = await fetch(`${STUB}/_stub/seed`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ table, rows }) });
  if (!res.ok) throw new Error(`seed ${table} → ${res.status}: ${await res.text()}`);
}
const iso = (mins) => new Date(Date.now() + mins * 60_000).toISOString();
const uuid = () => crypto.randomUUID();

const FIXTURES = [
  ["Arsenal", "Chelsea"], ["Liverpool", "Man City"], ["Man United", "Everton"],
  ["Spurs", "Brentford"], ["Newcastle", "Aston Villa"], ["Brighton", "West Ham"],
  ["Crystal Palace", "Fulham"], ["Wolves", "Bournemouth"],
  ["Nottingham Forest", "Leeds"], ["Burnley", "Sunderland"],
];
// [fans, avg] — rigged so the AVERAGE rule is visible (Brentford few+sharp beats
// Man United many+casual; Forest below the min-5 bar → unranked).
const CLUB_FANS = {
  "Brentford": [8, 9200], "Brighton": [11, 8400], "Crystal Palace": [9, 7900],
  "Arsenal": [42, 6100], "Spurs": [31, 5600], "Liverpool": [38, 5400],
  "Newcastle": [17, 5100], "Aston Villa": [14, 4800], "Chelsea": [29, 4500],
  "Man City": [26, 4300], "West Ham": [12, 4000], "Everton": [13, 3800],
  "Wolves": [7, 3500], "Fulham": [6, 3300], "Man United": [60, 3100],
  "Bournemouth": [5, 2900], "Leeds": [6, 2600], "Burnley": [5, 2300],
  "Sunderland": [5, 2100], "Nottingham Forest": [4, 9900],
};

console.log(`\nMATCHWEEK DEMO — stub :${STUB_PORT}, app :${APP_PORT}\n`);
start(process.execPath, [join(HERE, "stub-supabase.mjs"), "--port", String(STUB_PORT)]);
await waitFor(`${STUB}/rest/v1/halftime_releases`);

// ── 1. PL News: real RSS, written straight into the stub ────────────────────
console.log("fetching live football news…");
await run(process.execPath, [join(REPO, "scripts", "pl-news-ingest.mjs")], { PL_NEWS_TARGET: STUB });

// ── 2. halftime_releases: GW1 (past, released) + GW2/GW3 (future) ───────────
const releases = [], packs = [];
const gw1PackIds = [];
// GW1 — kicked off ~46h ago, released, with packs (feeds the leaderboard).
FIXTURES.forEach(([home, away], i) => {
  const packId = uuid(); gw1PackIds.push(packId);
  releases.push({
    id: uuid(), fixture_id: 910000 + i, season_id: SEASON, round_name: "1",
    pack_id: packId, home, away, kickoff_at: iso(-46 * 60 + i),
    state: "released", released_at: iso(-46 * 60 + 50 + i),
    base_questions: [], fresh_questions: [], pack_questions: [], fresh_state: "skipped",
    created_at: iso(-3000), updated_at: iso(-2000),
  });
  packs.push({ id: packId, name: `Halftime: ${home} v ${away}`, type: "records", parameter: String(910000 + i), source: "system", status: "published", rotation_active: true, featured: false, question_count: 10, questions: [] });
});
// GW2 (+2 days) and GW3 (+9 days) — future, scheduled → the upcoming schedule.
[["2", 2 * 24 * 60], ["3", 9 * 24 * 60]].forEach(([round, base]) => {
  FIXTURES.forEach(([home, away], i) => {
    releases.push({
      id: uuid(), fixture_id: Number(round) * 100000 + i, season_id: SEASON, round_name: round,
      pack_id: null, home, away, kickoff_at: iso(base + i * 150),
      state: "scheduled", base_questions: [], fresh_questions: [], pack_questions: [],
      fresh_state: "none", created_at: iso(-3000), updated_at: iso(-3000),
    });
  });
});
await seed("halftime_releases", releases);
await seed("quiz_packs", packs);
console.log(`seeded ${releases.length} releases (GW1 released + GW2/GW3 scheduled), ${packs.length} packs`);

// ── 3. fans + attempts for GW1 (the leaderboard) ────────────────────────────
const profiles = [], supporters = [], attempts = [];
let n = 0;
for (const [club, [fanCount, avg]] of Object.entries(CLUB_FANS)) {
  for (let f = 0; f < fanCount; f++) {
    const userId = uuid();
    profiles.push({ id: userId, username: `${club.toLowerCase().replace(/\W/g, "")}_fan${f + 1}`, notifications_opt_in: true });
    supporters.push({ user_id: userId, club, season_id: SEASON, created_at: iso(-500) });
    const jitter = 1 + (((n * 37) % 50) - 25) / 100;
    attempts.push({ id: uuid(), user_id: userId, pack_id: gw1PackIds[n % gw1PackIds.length], score: Math.round(avg * jitter), max_score: 12000, correct_count: 7, answers: [], completed_at: iso(-60) });
    n++;
  }
}
await seed("profiles", profiles);
await seed("club_supporters", supporters);
await seed("quiz_attempts", attempts);
console.log(`seeded ${profiles.length} fans + ${attempts.length} GW1 attempts`);

// ── 4. boot ─────────────────────────────────────────────────────────────────
start("npx", ["next", "dev", "-p", String(APP_PORT)], {
  stdio: ["ignore", "ignore", "ignore"],
  env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: STUB, SUPABASE_SERVICE_ROLE_KEY: "stub-service-role-key", NEXT_PUBLIC_SUPABASE_ANON_KEY: "stub-anon-key", SPORTMONKS_BASE_URL: STUB, SPORTMONKS_API_KEY: "demo-key", CRON_SECRET: "demo-secret", NEXT_TELEMETRY_DISABLED: "1" },
});
await waitFor(`${APP}/api/pl/news`, 180000);
const news = await (await fetch(`${APP}/api/pl/news`)).json();
const up = await (await fetch(`${APP}/api/halftime/upcoming`)).json();
const tbl = await (await fetch(`${APP}/api/clubs/table`)).json();
console.log(`\nPL News:   ${news?.doc?.items?.length ?? 0} live items`);
console.log(`Schedule:  ${(up?.gameweeks ?? []).map((g) => `GW${g.round}(${g.fixtures.length})`).join(" ")}`);
console.log(`Leaderboard: GW${tbl?.gw ?? "—"}, ${(tbl?.standings ?? []).filter((s) => s.eligible).length} clubs ranked`);
console.log(`\nOPEN:  ${APP}/matchweek\n\nCtrl-C to stop.\n`);
await new Promise(() => {});
