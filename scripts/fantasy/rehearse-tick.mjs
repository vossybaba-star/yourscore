/**
 * THE TICK REHEARSAL — prove the season runs itself, before it has to.
 *
 * The live engine's first real execution is gameweek 1 on 21 August, with real
 * managers watching and no way to re-run it. Replay mode is gone, so there is no
 * sandbox left. This stages one throwaway gameweek with a deadline already in
 * the past, pointed at a REAL completed Premier League weekend, and drives the
 * actual cron route until the gameweek closes itself:
 *
 *     open ──(deadline passed)──> locked ──(matches ended)──> scored ──> final
 *
 * Deliberate choices:
 *   - gameweek number 900, so it can never collide with the seeded 1-38 and
 *     `currentGw` (which takes the LOWEST non-final live row) still hands real
 *     users gameweek 1 throughout.
 *   - window 8-10 Nov 2025 (SportMonks season 25583): finished matches with real
 *     lineups and stats, so ingest and scoring do actual work. Player ids are
 *     stable across seasons, so the 26/27 pool matches on the players who were
 *     also in the league last season — partial coverage is expected and fine.
 *   - every notification the run would emit is CLAIMED in notification_log up
 *     front. `notifyUsers` logs before it delivers and skips anyone already
 *     logged, so pre-claiming is the system's own mute button — without it,
 *     finalising a July-dated gameweek announces a bogus "July is settled" month
 *     winner to every member of every league, including real ones.
 *
 * Everything it writes, it deletes. Run:
 *
 *   node --env-file=.env.local scripts/fantasy/rehearse-tick.mjs --yes
 *   node --env-file=.env.local scripts/fantasy/rehearse-tick.mjs --yes --keep
 *   node --env-file=.env.local scripts/fantasy/rehearse-tick.mjs --clean
 */
import { createClient } from "@supabase/supabase-js";
import { signInBot } from "../health/lib/auth.mjs";

const GW = 900;
const WINDOW_START = "2025-11-08";
const WINDOW_END = "2025-11-10";
const SM_SEASON = 25583;
const BASE = process.env.REHEARSE_BASE ?? "http://localhost:3411";
const MAX_TICKS = 8;

const args = process.argv.slice(2);
const KEEP = args.includes("--keep");
const CLEAN_ONLY = args.includes("--clean");
if (!args.includes("--yes") && !CLEAN_ONLY) {
  console.error("refusing to write without --yes (or pass --clean to tear down a previous run)");
  process.exit(1);
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let failed = 0;
const ok = (m, extra = "") => console.log(`  ✓ ${m}${extra ? ` — ${extra}` : ""}`);
const bad = (m, extra = "") => { console.log(`  ✗ ${m}${extra ? ` — ${extra}` : ""}`); failed++; };
const check = (cond, m, extra = "") => (cond ? ok(m, extra) : bad(m, extra));

// ── cleanup ──────────────────────────────────────────────────────────────────
async function teardown(userId) {
  await db.from("fantasy_entries").delete().eq("gw", GW);
  await db.from("fantasy_player_scores").delete().eq("gw", GW);
  await db.from("fantasy_player_prices").delete().eq("gw", GW);
  await db.from("fantasy_gameweeks").delete().eq("gw", GW);
  await db.from("notification_log").delete().like("key", `%:${GW}`);
  if (userId) {
    await db.from("fantasy_entries").delete().eq("user_id", userId);
    await db.from("fantasy_squads").delete().eq("user_id", userId);
  }
}

if (CLEAN_ONLY) {
  const { userId } = await signInBot();
  await teardown(userId);
  await db.from("notification_log").delete().eq("key", `fantasy-result:${GW}`);
  console.log("torn down");
  process.exit(0);
}

// ── 0. safety gate ───────────────────────────────────────────────────────────
console.log("\n── 0. safety ──");
const { data: realGws } = await db.from("fantasy_gameweeks").select("gw, status, mode").lte("gw", 38);
const started = (realGws ?? []).filter((g) => g.status !== "open");
check(started.length === 0, "no real gameweek has started yet, safe to stage a rehearsal",
  started.length ? `${started.length} already moved` : "all 38 open");
if (started.length) process.exit(1);

const { userId, cookieHeader } = await signInBot();
const call = async (path, body, method) => {
  const res = await fetch(`${BASE}/api/fantasy/${path}`, {
    method: method ?? (body !== undefined ? "POST" : "GET"),
    headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};

await teardown(userId);

// ── 1. stage the gameweek ────────────────────────────────────────────────────
console.log("\n── 1. stage ──");
const deadline = new Date(Date.now() - 10 * 60_000).toISOString();
const { error: insErr } = await db.from("fantasy_gameweeks").insert({
  gw: GW, season: "REHEARSAL", mode: "live",
  window_start: WINDOW_START, window_end: WINDOW_END,
  deadline, status: "open", sm_season_id: SM_SEASON,
});
check(!insErr, `gameweek ${GW} staged, deadline 10 minutes ago`, insErr?.message ?? deadline);
if (insErr) process.exit(1);

// A squad to lock. Without one the run proves the state machine but nothing about
// the manager-facing half of it.
const pool = (await call("pool")).json.players;
const clubCount = {};
const take = (pos, n) => {
  const out = [];
  // Cheapest first: a dearest-first squad blows the £100m budget and the build 400s.
  for (const p of pool.filter((x) => x.pos === pos).sort((a, b) => a.price - b.price)) {
    if (out.length >= n) break;
    if ((clubCount[p.clubId] ?? 0) >= 2) continue;
    clubCount[p.clubId] = (clubCount[p.clubId] ?? 0) + 1;
    out.push(p.id);
  }
  return out;
};
const built = await call("squad", { pickIds: [...take("GK", 2), ...take("DEF", 5), ...take("MID", 5), ...take("FWD", 3)] });
check(built.status === 200, "test squad built for the rehearsal manager", built.status === 200 ? "" : JSON.stringify(built.json));
if (built.status !== 200) process.exit(1);
const before = (await db.from("fantasy_squads").select("credits, chip_log").eq("user_id", userId).single()).data;
console.log(`    starting balances: credits=${before.credits} chips_played=${(before.chip_log ?? []).length}`);

// ── 2. mute every notification this run would emit ───────────────────────────
console.log("\n── 2. mute ──");
const { data: leagues } = await db.from("fantasy_leagues").select("id");
const { data: members } = await db.from("fantasy_league_members").select("league_id, user_id");
const monthKey = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit" })
  .formatToParts(new Date(deadline))
  .reduce((acc, p) => (p.type === "year" ? { ...acc, y: p.value } : p.type === "month" ? { ...acc, m: p.value } : acc), {});
const key = `${monthKey.y}-${monthKey.m}`;
const claims = [];
for (const l of leagues ?? [])
  for (const m of (members ?? []).filter((x) => x.league_id === l.id))
    claims.push({ user_id: m.user_id, key: `fantasy-month:${l.id}:${key}` });
claims.push({ user_id: userId, key: `fantasy-result:${GW}` });
const { error: claimErr } = await db.from("notification_log").insert(claims);
check(!claimErr, `${claims.length} notification keys pre-claimed (month ${key} + result)`, claimErr?.message ?? "");

// ── 3. drive the real cron route ─────────────────────────────────────────────
console.log("\n── 3. tick ──");
const secret = process.env.CRON_SECRET;
let status = "open";
for (let i = 1; i <= MAX_TICKS && status !== "final"; i++) {
  const res = await fetch(`${BASE}/api/cron/fantasy-tick`, { headers: { Authorization: `Bearer ${secret}` } });
  const body = await res.json();
  const mine = (body.report ?? []).filter((r) => r.gw === GW);
  console.log(`  tick ${i}: ${mine.map((r) => `${r.action} — ${r.detail}`).join(" | ") || "(nothing for this gameweek)"}`);
  status = (await db.from("fantasy_gameweeks").select("status").eq("gw", GW).single()).data?.status;
  console.log(`           gameweek is now: ${status}`);
}

// ── 4. verify ────────────────────────────────────────────────────────────────
console.log("\n── 4. verify ──");
check(status === "final", "the gameweek closed itself, with nobody pressing anything", `status=${status}`);

const { data: entry } = await db.from("fantasy_entries").select("*").eq("gw", GW).eq("user_id", userId).maybeSingle();
check(!!entry?.locked_at, "the squad was snapshotted at the deadline", entry?.locked_at ?? "no entry");
check(entry?.round_done_at == null, "and rolled over unplayed, exactly as the roll-over rule says");
check(entry?.points != null, "it scored against real match data", `points=${entry?.points}`);
check(entry?.status === "final", "the entry finalised", `status=${entry?.status}`);
check(Array.isArray(entry?.points_breakdown) && entry.points_breakdown.length > 0,
  "with a per-player breakdown", `${entry?.points_breakdown?.length ?? 0} rows`);

const { count: scoreRows } = await db.from("fantasy_player_scores")
  .select("*", { count: "exact", head: true }).eq("gw", GW);
check((scoreRows ?? 0) > 0, "player stats were ingested from SportMonks", `${scoreRows} players`);

const after = (await db.from("fantasy_squads").select("credits, chip_log").eq("user_id", userId).single()).data;
check(after.credits > before.credits || after.credits === 5,
  "the baseline transfer for the next gameweek was granted", `credits ${before.credits} → ${after.credits}`);
check((after.chip_log ?? []).length === (before.chip_log ?? []).length,
  "a rolled-over week played no chip (monthly rotation is untouched by finalise)",
  `chips_played ${(before.chip_log ?? []).length} → ${(after.chip_log ?? []).length}`);

// Idempotency: the whole point of pure-recompute scoring.
const pointsBefore = entry.points;
await fetch(`${BASE}/api/cron/fantasy-tick`, { headers: { Authorization: `Bearer ${secret}` } });
const { data: again } = await db.from("fantasy_entries").select("points, status").eq("gw", GW).eq("user_id", userId).single();
check(again.points === pointsBefore, "re-running the tick changes nothing", `${pointsBefore} → ${again.points}`);
const afterTwice = (await db.from("fantasy_squads").select("credits").eq("user_id", userId).single()).data;
check(afterTwice.credits === after.credits, "and never grants a second baseline transfer", `credits=${afterTwice.credits}`);

// ── 5. tear down ─────────────────────────────────────────────────────────────
if (KEEP) {
  console.log("\n── 5. kept (pass --clean to tear down) ──");
} else {
  console.log("\n── 5. tear down ──");
  await teardown(userId);
  await db.from("notification_log").delete().eq("key", `fantasy-result:${GW}`);
  for (const c of claims) await db.from("notification_log").delete().eq("user_id", c.user_id).eq("key", c.key);
  const { count: left } = await db.from("fantasy_gameweeks").select("*", { count: "exact", head: true }).eq("gw", GW);
  const { count: gws } = await db.from("fantasy_gameweeks").select("*", { count: "exact", head: true });
  check(left === 0 && gws === 38, "rehearsal removed, 38 real gameweeks intact", `gameweeks=${gws}`);
}

console.log(failed ? `\n${failed} CHECK(S) FAILED` : "\nREHEARSAL PASSED — the season runs itself");
process.exit(failed ? 1 : 0);
