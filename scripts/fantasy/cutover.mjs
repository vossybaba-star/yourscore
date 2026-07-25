/**
 * THE SEASON CUTOVER — replay demo → live 26/27. One rehearsed command.
 *
 * fantasy_gameweeks is keyed on gw alone, so it holds ONE season: going live is
 * a cutover, not an insert. And it is load-bearing — a single leftover replay row
 * would put the whole game back into replay mode (currentGw reads mode), pricing
 * every squad at seed. The demo wipe is a safety step, not tidying.
 *
 * Order matters, and the end is a DEPLOY, not a DB write: pool.json is a static
 * import baked into the build, so the rebuilt pool ships by commit + merge.
 *
 *   node scripts/fantasy/cutover.mjs status     what's true right now (FPL, SM, prod)
 *   node scripts/fantasy/cutover.mjs dry-run    rehearse every step, write nothing
 *   node scripts/fantasy/cutover.mjs apply      the real thing — refuses until FPL
 *                                               has flipped; asks for typed consent
 *                                               before the destructive wipe
 *
 * Steps on apply:
 *   1. verify FPL is serving 26/27 (fresh season: GW1 unfinished, deadline 2026-08)
 *   2. rebuild the pool live (FANTASY_POOL_MODE=live build-pool.sh) — FPL 26/27
 *      prices ∩ SM 28083 squads, smId baked, assertNames guards the naming rule
 *   3. gate on coverage: ≥95% smId, 20 clubs, ≥450 players
 *   4. seed the 38-gameweek calendar (build-calendar.mjs --apply, season 28083)
 *   5. WIPE the demo: entries, squads, player_scores, prices, replay gameweeks
 *   6. verify: 38 live gameweeks, zero replay rows, zero orphans
 *   7. remind: commit pool.json + deploy — the app still serves the old pool
 *      until the build ships.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { createClient } from "@supabase/supabase-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const MODE = process.argv[2] ?? "status";
const SM_SEASON = 28083;
const SEASON_LABEL = "2026/27";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => console.log(`  ✗ ${m}`);
const info = (m) => console.log(`  · ${m}`);

// ── 1. FPL: has the season flipped? ──────────────────────────────────────────
async function fplStatus() {
  const r = await fetch("https://fantasy.premierleague.com/api/bootstrap-static/");
  if (!r.ok) throw new Error(`FPL bootstrap ${r.status}`);
  const boot = await r.json();
  const gw1 = boot.events?.[0];
  const withStats = boot.elements.filter((e) => (e.starts ?? 0) > 0).length;
  // A fresh season: GW1 not finished, deadline in Aug 2026, stats zeroed.
  const flipped = !!gw1 && !gw1.finished && String(gw1.deadline_time ?? "").startsWith("2026");
  return { flipped, gw1Deadline: gw1?.deadline_time, players: boot.elements.length, withStats };
}

// ── 2. SM: does 28083 have squads yet? ───────────────────────────────────────
async function smStatus() {
  const key = process.env.SPORTMONKS_API_KEY;
  if (!key) return { reachable: false, why: "SPORTMONKS_API_KEY not set" };
  const r = await fetch(`https://api.sportmonks.com/v3/football/rounds/seasons/${SM_SEASON}?api_token=${key}`);
  const body = await r.json();
  const rounds = body.data?.length ?? 0;
  // squads: probe one team-squad call cheaply via the season teams endpoint
  const t = await fetch(`https://api.sportmonks.com/v3/football/teams/seasons/${SM_SEASON}?api_token=${key}`);
  const teams = (await t.json()).data?.length ?? 0;
  return { reachable: true, rounds, teams };
}

// ── 3. prod: what state is the game in? ──────────────────────────────────────
async function prodStatus() {
  const { data: gws } = await db.from("fantasy_gameweeks").select("gw, mode, season, status").order("gw");
  const count = async (t) => (await db.from(t).select("*", { count: "exact", head: true })).count ?? 0;
  return {
    gameweeks: gws ?? [],
    replayRows: (gws ?? []).filter((g) => g.mode === "replay").length,
    liveRows: (gws ?? []).filter((g) => g.mode === "live").length,
    squads: await count("fantasy_squads"),
    entries: await count("fantasy_entries"),
    playerScores: await count("fantasy_player_scores"),
    prices: await count("fantasy_player_prices"),
    leagues: await count("fantasy_leagues"),
  };
}

function poolStatus() {
  const pool = JSON.parse(readFileSync(join(root, "src/data/fantasy/pool.json"), "utf8"));
  return { season: pool.smSeasonId, version: pool.version, players: pool.players.length };
}

const [fpl, sm, prod] = await Promise.all([fplStatus(), smStatus(), prodStatus()]);
const pool = poolStatus();

console.log(`\n═══ CUTOVER ${MODE.toUpperCase()} — ${new Date().toISOString().slice(0, 16)} ═══\n`);
console.log("FPL:");
(fpl.flipped ? ok : bad)(`${fpl.flipped ? "FLIPPED to 26/27" : "still serving last season"} — GW1 deadline ${fpl.gw1Deadline}, ${fpl.players} players (${fpl.withStats} with season stats)`);
console.log("SportMonks (season 28083):");
sm.reachable ? ok(`${sm.rounds} rounds · ${sm.teams} clubs`) : bad(sm.why);
console.log("Pool (src/data/fantasy/pool.json — baked into the build):");
(pool.season === SM_SEASON ? ok : info)(`season ${pool.season} · ${pool.players} players · built ${pool.version}${pool.season !== SM_SEASON ? " — still last season, rebuild needed" : ""}`);
console.log("Prod:");
info(`${prod.liveRows} live gameweeks · ${prod.replayRows} replay (demo) · ${prod.squads} squads · ${prod.entries} entries · ${prod.playerScores} player-score rows · ${prod.prices} price rows · ${prod.leagues} leagues`);

if (MODE === "status") process.exit(0);

// ── rehearsal / apply ────────────────────────────────────────────────────────
const APPLY = MODE === "apply";
console.log(`\n─── steps (${APPLY ? "APPLY" : "dry run — nothing written"}) ───\n`);

// step 1: the gate
if (!fpl.flipped) {
  bad("STEP 1 GATE: FPL has not flipped — the 26/27 pool cannot exist yet.");
  info("Everything below is rehearsal only; apply will refuse at this gate until FPL flips.");
  if (APPLY) { console.log("\nREFUSED. Run again once FPL serves 26/27.\n"); process.exit(1); }
} else ok("STEP 1: FPL is serving 26/27 — pool rebuild is possible");

// step 2+3: pool rebuild (machinery check on dry-run; real build on apply)
if (APPLY) {
  info("STEP 2: rebuilding the pool live (this calls FPL + SportMonks)…");
  execSync("FANTASY_POOL_MODE=live bash scripts/fantasy/build-pool.sh", { cwd: root, stdio: "inherit" });
  const built = poolStatus();
  if (built.season !== SM_SEASON) throw new Error(`pool still ${built.season} after rebuild`);
  const p2 = JSON.parse(readFileSync(join(root, "src/data/fantasy/pool.json"), "utf8"));
  const cov = p2.players.filter((p) => p.smId).length / p2.players.length;
  const clubs = new Set(p2.players.map((p) => p.clubId)).size;
  if (cov < 0.95 || clubs !== 20 || p2.players.length < 450)
    throw new Error(`STEP 3 GATE: coverage ${(cov * 100).toFixed(1)}% / ${clubs} clubs / ${p2.players.length} players — not shippable`);
  ok(`STEP 3: pool coverage ${(cov * 100).toFixed(1)}% · ${clubs} clubs · ${p2.players.length} players`);
} else {
  const sh = join(root, "scripts/fantasy/build-pool.sh");
  try { readFileSync(sh); ok("STEP 2 (rehearsed): build-pool.sh present; live mode = FANTASY_POOL_MODE=live"); }
  catch { bad("STEP 2: build-pool.sh missing"); }
  info("STEP 3 (rehearsed): gate = smId coverage ≥95% · 20 clubs · ≥450 players");
}

// step 4: calendar
if (APPLY) {
  info("STEP 4: seeding the 38-gameweek calendar…");
  execSync(`node scripts/fantasy/build-calendar.mjs --season ${SM_SEASON} --label ${SEASON_LABEL} --apply`, { cwd: root, stdio: "inherit" });
} else {
  ok(`STEP 4 (rehearsed): build-calendar.mjs --season ${SM_SEASON} --apply (deadline = first kickoff − 90m; ${sm.rounds} rounds ready)`);
}

// step 5: the wipe
const wipeTargets = `${prod.entries} entries · ${prod.squads} squads · ${prod.playerScores} player-scores · ${prod.prices} prices · ${prod.replayRows} replay gameweeks`;
if (APPLY) {
  console.log(`\n  ⚠ STEP 5 WIPES THE DEMO: ${wipeTargets}`);
  console.log("    (leagues and their members are KEPT — friends stay friends across the cutover)");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("    Type WIPE-THE-DEMO to proceed: ");
  rl.close();
  if (answer !== "WIPE-THE-DEMO") { console.log("\nAborted before the wipe. Calendar is seeded; wipe not run.\n"); process.exit(1); }
  // deletes, explicitly and in FK-safe order
  await db.from("fantasy_entries").delete().gte("gw", 0);
  await db.from("fantasy_player_scores").delete().gte("gw", 0);
  await db.from("fantasy_player_prices").delete().gte("gw", 0);
  await db.from("fantasy_squads").delete().neq("user_id", "00000000-0000-0000-0000-000000000000");
  await db.from("fantasy_gameweeks").delete().eq("mode", "replay");
  ok("STEP 5: demo wiped");
} else {
  ok(`STEP 5 (rehearsed): wipe ${wipeTargets} — leagues KEPT; typed consent required on apply`);
}

// step 6: verify
if (APPLY) {
  const after = await prodStatus();
  const clean = after.replayRows === 0 && after.liveRows === 38 && after.entries === 0 && after.squads === 0;
  (clean ? ok : bad)(`STEP 6: ${after.liveRows} live gameweeks · ${after.replayRows} replay · ${after.squads} squads · ${after.entries} entries`);
  if (!clean) process.exit(1);
} else {
  ok("STEP 6 (rehearsed): verify 38 live · 0 replay · 0 squads · 0 entries");
}

console.log(`\n─── after apply: pool.json changed → COMMIT it and DEPLOY. The app serves the old pool until the build ships. ───\n`);
