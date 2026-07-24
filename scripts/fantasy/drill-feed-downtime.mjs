/**
 * THE FEED-DOWNTIME DRILL — prove the season holds when SportMonks doesn't.
 *
 * The design calls this out by name: "if the feed is down near the deadline, hold
 * the gameweek open — never lock stale data. Reliability at the deadline is
 * sacred." That is a claim about behaviour under failure, and the only way to
 * know it is true is to break the feed and watch.
 *
 * Three things have to hold, and they are not the same thing:
 *
 *   1. THE LOCK STILL HAPPENS. Snapshotting squads is a database-only operation,
 *      so a dead feed must not stop it. A manager who misses the deadline during
 *      an outage still plays — that's the roll-over rule, and it cannot depend on
 *      a third party being up.
 *   2. NOTHING IS SCORED. No partial writes, no zeroes standing in for missing
 *      stats, no status advanced on data we don't have.
 *   3. IT RECOVERS BY ITSELF. When the feed comes back, the next ordinary tick
 *      catches the gameweek up with no human intervention and no lost state.
 *
 * The outage is simulated the only honest way: point the gameweek at a window
 * with no fixtures in it, which is exactly what an empty feed response looks like
 * to `ingestGameweek` ("no fixtures returned — holding").
 *
 *   node --env-file=.env.local scripts/fantasy/drill-feed-downtime.mjs --yes
 */
import { createClient } from "@supabase/supabase-js";
import { signInBot } from "../health/lib/auth.mjs";
import { muteComms } from "./lib/mute-comms.mjs";

const GW = 901;
const DEAD_WINDOW = { start: "2025-06-10", end: "2025-06-12" }; // close season: no PL fixtures
const LIVE_WINDOW = { start: "2025-11-08", end: "2025-11-10" }; // a real gameweek
const SM_SEASON = 25583;
const BASE = process.env.REHEARSE_BASE ?? "http://localhost:3411";

if (!process.argv.includes("--yes")) {
  console.error("refusing to write without --yes");
  process.exit(1);
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { userId, cookieHeader } = await signInBot();

let failed = 0;
const check = (cond, msg, extra = "") => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${msg}${extra ? ` — ${extra}` : ""}`);
  if (!cond) failed++;
};

async function teardown() {
  await db.from("fantasy_entries").delete().eq("gw", GW);
  await db.from("fantasy_player_scores").delete().eq("gw", GW);
  await db.from("fantasy_player_prices").delete().eq("gw", GW);
  await db.from("fantasy_gameweeks").delete().eq("gw", GW);
  await db.from("notification_log").delete().like("key", `%:${GW}`);
}

const tick = async () => {
  const res = await fetch(`${BASE}/api/cron/fantasy-tick`, {
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  const body = await res.json();
  return (body.report ?? []).filter((r) => r.gw === GW);
};
const gwStatus = async () =>
  (await db.from("fantasy_gameweeks").select("status").eq("gw", GW).single()).data?.status;
const entry = async () =>
  (await db.from("fantasy_entries").select("*").eq("gw", GW).eq("user_id", userId).maybeSingle()).data;

await teardown();

// A squad to protect. Without one this drills the state machine and nothing else.
const call = async (p, b, m) => {
  const r = await fetch(`${BASE}/api/fantasy/${p}`, {
    method: m ?? (b !== undefined ? "POST" : "GET"),
    headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
    body: b !== undefined ? JSON.stringify(b) : undefined,
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
const st = await call("state");
if (!st.json.squad) { console.error("the bot needs a squad before this drill"); process.exit(1); }

console.log("\n── the outage ──");
const deadline = new Date(Date.now() - 10 * 60_000).toISOString();
await db.from("fantasy_gameweeks").insert({
  gw: GW, season: "DRILL", mode: "live",
  window_start: DEAD_WINDOW.start, window_end: DEAD_WINDOW.end,
  deadline, status: "open", sm_season_id: SM_SEASON,
});
// BEFORE the first tick, always. Recovery drives this gameweek to final, which
// fires the result push and a month-winner announcement to every league member —
// real accounts with real phones. The first run of this drill did exactly that.
const claims = await muteComms(db, { gw: GW, deadline, userIds: [userId] });
console.log(`  gameweek staged, deadline passed, feed returns nothing · ${claims.length} comms muted`);

const outage = await tick();
console.log("  tick:", outage.map((r) => `${r.action} — ${r.detail}`).join(" | "));

const afterOutage = await entry();
check(await gwStatus() === "locked", "1. the deadline still locked the gameweek", `status=${await gwStatus()}`);
check(!!afterOutage?.locked_at, "   every squad was snapshotted anyway", afterOutage?.locked_at ?? "no entry");
check(afterOutage?.points == null, "2. nothing was scored", `points=${afterOutage?.points ?? "null"}`);
check(afterOutage?.scored_at == null, "   and no score timestamp was written");
check(outage.some((r) => r.action === "held"), "   the tick reported HOLDING, not progress",
  outage.find((r) => r.action === "held")?.detail ?? "no hold reported");

const { count: scoreRows } = await db.from("fantasy_player_scores")
  .select("*", { count: "exact", head: true }).eq("gw", GW);
check((scoreRows ?? 0) === 0, "   no partial player stats were written", `${scoreRows} rows`);

// A second tick while still dark must not "give up" and advance anyway.
const outage2 = await tick();
check(await gwStatus() === "locked", "   a second tick in the dark still holds", `status=${await gwStatus()}`);
check(outage2.some((r) => r.action === "held"), "   and still reports holding");

console.log("\n── the recovery ──");
await db.from("fantasy_gameweeks")
  .update({ window_start: LIVE_WINDOW.start, window_end: LIVE_WINDOW.end })
  .eq("gw", GW);
console.log("  feed restored, no other intervention");

const recovered = await tick();
console.log("  tick:", recovered.map((r) => `${r.action} — ${r.detail}`).join(" | "));
const afterRecovery = await entry();
check(afterRecovery?.points != null, "3. the next ordinary tick scored it", `points=${afterRecovery?.points}`);
check(afterRecovery?.locked_at === afterOutage?.locked_at,
  "   and the lock taken during the outage was NOT overwritten",
  `${afterOutage?.locked_at} → ${afterRecovery?.locked_at}`);

console.log("\n── tear down ──");
await teardown();
const { count: gws } = await db.from("fantasy_gameweeks").select("*", { count: "exact", head: true });
check(gws === 38, "drill removed, 38 real gameweeks intact", `gameweeks=${gws}`);

console.log(failed ? `\n${failed} CHECK(S) FAILED` : "\nDRILL PASSED — the season holds when the feed doesn't");
process.exit(failed ? 1 : 0);
