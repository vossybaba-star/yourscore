#!/usr/bin/env node
/**
 * demo-matchweek.mjs — the whole Matchweek hub on REAL 2026/27 data.
 *
 *   PL → News       real RSS headlines + our own blog posts plugged in
 *   PL → Table      the real 26/27 Premier League table (live SportMonks; 0 pts pre-season)
 *   Live Quiz       real fixtures — GW1 shown as just-played (the fan leaderboard),
 *                   GW2+ as the upcoming-quiz carousel — plus "how fans did" stat tiles
 *
 * Real fixtures come straight from SportMonks (season 28083). GW1 is shifted into
 * the recent past so the leaderboard has a completed gameweek to rank; GW2/3/4
 * keep their real future dates so the carousel shows what's genuinely next.
 * DB is the in-memory stub; standings are fetched from the REAL SportMonks API.
 *
 * Run:  node scripts/halftime/demo-matchweek.mjs   (app on :3404, Ctrl-C to stop)
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as sm from "./lib/sm.mjs";
import { loadEnvFile } from "./lib/env.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const STUB_PORT = 8793;
const APP_PORT = 3404;
const STUB = `http://127.0.0.1:${STUB_PORT}`;
const APP = `http://127.0.0.1:${APP_PORT}`;
const SEASON = 28083;

loadEnvFile();
const SM_KEY = process.env.SPORTMONKS_API_KEY;
const SM_BASE = process.env.SPORTMONKS_BASE_URL || "https://api.sportmonks.com";
if (!SM_KEY) throw new Error("No SPORTMONKS_API_KEY in .env.local");

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
const nameOf = (fx, loc) => {
  const ps = Array.isArray(fx.participants) ? fx.participants : (fx.participants?.data ?? []);
  return ps.find((p) => p.meta?.location === loc)?.name ?? "?";
};

console.log(`\nMATCHWEEK DEMO (real 26/27 data) — stub :${STUB_PORT}, app :${APP_PORT}\n`);

// ── real fixtures from SportMonks ───────────────────────────────────────────
console.log("fetching real 26/27 fixtures from SportMonks…");
const raw = await sm.fixturesBetween("2026-08-01", "2026-09-30");
const byRound = new Map();
for (const fx of raw) {
  const round = fx.round?.name ?? String(fx.round_id ?? "?");
  if (!byRound.has(round)) byRound.set(round, []);
  byRound.get(round).push({ home: nameOf(fx, "home"), away: nameOf(fx, "away"), ko: fx.starting_at?.replace(" ", "T") + "Z", smId: fx.id });
}
const rounds = [...byRound.keys()].filter((r) => /^\d+$/.test(r)).sort((a, b) => Number(a) - Number(b));
const gw1 = byRound.get(rounds[0]) ?? [];
console.log(`  got GWs ${rounds.slice(0, 4).join(", ")} — GW${rounds[0]} has ${gw1.length} fixtures`);

start(process.execPath, [join(HERE, "stub-supabase.mjs"), "--port", String(STUB_PORT)]);
await waitFor(`${STUB}/rest/v1/halftime_releases`);

// ── 1. PL News: real RSS + our blog (blog is merged in the route) ───────────
console.log("fetching live football news…");
await run(process.execPath, [join(REPO, "scripts", "pl-news-ingest.mjs")], { PL_NEWS_TARGET: STUB });

// ── 2. halftime_releases: GW1 played (past) + GW2/3/4 upcoming (real dates) ──
const releases = [], packs = [], gw1PackIds = [];
// club -> the pack for THEIR GW1 fixture. The own-club scoring rule means a fan
// only scores off their own club's pack, so the seed has to hand each fan the
// right one; a round-robin would score zero for almost everyone.
const packByClub = new Map();
// GW1 → shifted to ~2 days ago, released, with packs (feeds the leaderboard).
gw1.forEach((fx, i) => {
  const packId = uuid(); gw1PackIds.push(packId);
  packByClub.set(fx.home, packId);
  packByClub.set(fx.away, packId);
  releases.push({
    id: uuid(), fixture_id: 700000 + i, season_id: SEASON, round_name: "1",
    pack_id: packId, home: fx.home, away: fx.away, kickoff_at: iso(-46 * 60 + i * 30),
    state: "released", released_at: iso(-46 * 60 + 50 + i * 30),
    base_questions: [], fresh_questions: [], pack_questions: [], fresh_state: "skipped",
    created_at: iso(-5000), updated_at: iso(-3000),
  });
  packs.push({ id: packId, name: `Halftime: ${fx.home} v ${fx.away}`, type: "records", parameter: String(700000 + i), source: "system", status: "published", rotation_active: true, featured: false, question_count: 10, questions: [] });
});
// GW2/3/4 → real future kickoffs, scheduled (feeds the upcoming-quiz carousel).
for (const round of rounds.slice(1, 4)) {
  for (const fx of byRound.get(round)) {
    releases.push({
      id: uuid(), fixture_id: fx.smId, season_id: SEASON, round_name: round,
      pack_id: null, home: fx.home, away: fx.away, kickoff_at: fx.ko,
      state: "scheduled", base_questions: [], fresh_questions: [], pack_questions: [],
      fresh_state: "none", created_at: iso(-5000), updated_at: iso(-5000),
    });
  }
}
await seed("halftime_releases", releases);
await seed("quiz_packs", packs);
console.log(`seeded ${releases.length} real fixtures (GW1 played + GW${rounds.slice(1,4).join("/")} upcoming)`);

// ── 3. fans + attempts for GW1 → the leaderboard (real club names) ──────────
// Fan counts/averages rigged so the AVERAGE rule shows: a small sharp fanbase
// tops a big casual one; one club below the min-5 bar stays unranked.
const gw1Clubs = [...new Set(gw1.flatMap((f) => [f.home, f.away]))];
const RIG = [[8, 9200], [11, 8400], [9, 7900], [42, 6100], [31, 5600], [38, 5400], [17, 5100], [14, 4800], [29, 4500], [26, 4300], [12, 4000], [13, 3800], [7, 3500], [6, 3300], [60, 3100], [5, 2900], [6, 2600], [5, 2300], [5, 2100], [4, 9900]];
const profiles = [], supporters = [], attempts = [];
let n = 0;
gw1Clubs.forEach((club, ci) => {
  const [fanCount, avg] = RIG[ci % RIG.length];
  for (let f = 0; f < fanCount; f++) {
    const userId = uuid();
    profiles.push({ id: userId, username: `${club.toLowerCase().replace(/\W/g, "")}_fan${f + 1}`, notifications_opt_in: true });
    supporters.push({ user_id: userId, club, season_id: SEASON, created_at: iso(-500) });
    const jitter = 1 + (((n * 37) % 50) - 25) / 100;
    attempts.push({ id: uuid(), user_id: userId, pack_id: packByClub.get(club), score: Math.round(avg * jitter), max_score: 12000, correct_count: 7, answers: [], completed_at: iso(-60) });
    n++;
  }
});
await seed("profiles", profiles);
await seed("club_supporters", supporters);
await seed("quiz_attempts", attempts);
console.log(`seeded ${profiles.length} fans + ${attempts.length} GW1 attempts across ${gw1Clubs.length} real clubs`);

// ── 4. quiz stat-highlight tiles (illustrative until real games run) ────────
const highlights = {
  items: [
    { id: "h1", question: "Which of these clubs has NEVER been relegated from the Premier League?", answer: "Arsenal", correctPct: 71, sampleSize: 1840, fixture: "Arsenal v Coventry City" },
    { id: "h2", question: "Who was the Premier League's top scorer in the 2025/26 season?", answer: "Erling Haaland", correctPct: 63, sampleSize: 1520, fixture: "Man City v Bournemouth" },
    { id: "h3", question: "Which club plays its home games at the City Ground?", answer: "Nottingham Forest", correctPct: 38, sampleSize: 1190, fixture: "Nottingham Forest v Leeds" },
    { id: "h4", question: "How many times have Liverpool won the European Cup / Champions League?", answer: "Six", correctPct: 22, sampleSize: 1360, fixture: "Newcastle v Liverpool" },
    { id: "h5", question: "Which manager has won the most Premier League titles?", answer: "Pep Guardiola", correctPct: 44, sampleSize: 1610 },
  ],
  updatedAt: iso(-30),
};
await seed("quiz_highlights", [{ id: 1, doc: highlights, updated_at: iso(-30) }]);
console.log(`seeded ${highlights.items.length} quiz stat highlights`);

// ── 5. boot — DB = stub, but standings hit the REAL SportMonks API ──────────
start("npx", ["next", "dev", "-p", String(APP_PORT)], {
  stdio: ["ignore", "ignore", "ignore"],
  env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: STUB, SUPABASE_SERVICE_ROLE_KEY: "stub-service-role-key", NEXT_PUBLIC_SUPABASE_ANON_KEY: "stub-anon-key", SPORTMONKS_BASE_URL: SM_BASE, SPORTMONKS_API_KEY: SM_KEY, CRON_SECRET: "demo-secret", NEXT_TELEMETRY_DISABLED: "1" },
});
await waitFor(`${APP}/api/pl/news`, 180000);
const news = await (await fetch(`${APP}/api/pl/news`)).json();
const up = await (await fetch(`${APP}/api/halftime/upcoming`)).json();
const tbl = await (await fetch(`${APP}/api/clubs/table`)).json();
const std = await (await fetch(`${APP}/api/pl/standings`)).json();
const hl = await (await fetch(`${APP}/api/pl/quiz-highlights`)).json();
const blogCount = (news?.doc?.items ?? []).filter((i) => i.source === "YourScore").length;
console.log(`\nPL News:     ${news?.doc?.items?.length ?? 0} items (${blogCount} of them our blog)`);
console.log(`PL Table:    ${(std?.standings ?? []).length} clubs (real SportMonks, ${std?.standings?.[0]?.points ?? 0} pts top)`);
console.log(`Carousel:    ${(up?.gameweeks ?? []).map((g) => `GW${g.round}(${g.fixtures.length})`).join(" ")}`);
console.log(`Leaderboard: GW${tbl?.gw ?? "—"}, ${(tbl?.standings ?? []).filter((s) => s.eligible).length} clubs ranked`);
console.log(`Stat tiles:  ${hl?.doc?.items?.length ?? 0}`);
console.log(`\nOPEN:  ${APP}/matchweek\n\nCtrl-C to stop.\n`);
await new Promise(() => {});
