/**
 * Stage a MID-WEEKEND gameweek, so the live screen can be looked at.
 *
 * The live phase is the one state that cannot be reached on demand: it exists
 * only between the deadline and the last final whistle of a real gameweek. So
 * this manufactures it, out of real data rather than fixtures:
 *
 *   1. insert gameweek 0 — it sorts FIRST, so `currentGw` (lowest non-final live
 *      row) hands it to the app, and gameweek 1's real row is never touched
 *   2. point it at a finished Premier League weekend and let the real tick lock,
 *      ingest and score it — genuine SportMonks stats, a genuine breakdown
 *   3. wind it back to provisional: entry status → locked, and delete the score
 *      rows of a few picks who scored nothing, so they read as STILL TO PLAY
 *      rather than as blanks. That is byte-for-byte the state the tick writes on
 *      a Saturday afternoon at `scoreGameweek({ final: false })`.
 *
 *   node --env-file=.env.local scripts/fantasy/stage-live-gw.mjs --yes
 *   node --env-file=.env.local scripts/fantasy/stage-live-gw.mjs --final
 *   node --env-file=.env.local scripts/fantasy/stage-live-gw.mjs --clean
 */
import { createClient } from "@supabase/supabase-js";
import { signInBot } from "../health/lib/auth.mjs";

const GW = 0;
const WINDOW_START = "2025-11-08";
const WINDOW_END = "2025-11-10";
const SM_SEASON = 25583;
const BASE = process.env.REHEARSE_BASE ?? "http://localhost:3411";
const STILL_TO_PLAY = 4;

const args = process.argv.slice(2);
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { userId, cookieHeader } = await signInBot();

async function clean() {
  await db.from("fantasy_entries").delete().eq("gw", GW);
  await db.from("fantasy_player_scores").delete().eq("gw", GW);
  await db.from("fantasy_player_prices").delete().eq("gw", GW);
  await db.from("fantasy_gameweeks").delete().eq("gw", GW);
  await db.from("notification_log").delete().like("key", `%:${GW}`);
  await db.from("notification_log").delete().like("key", "fantasy-month:%");
  await db.from("fantasy_entries").delete().eq("user_id", userId);
  await db.from("fantasy_squads").delete().eq("user_id", userId);
}

if (args.includes("--clean")) {
  await clean();
  const { count } = await db.from("fantasy_gameweeks").select("*", { count: "exact", head: true });
  console.log(`cleaned · gameweeks remaining: ${count}`);
  process.exit(0);
}

// Promote the staged gameweek from provisional to settled, to check the other half.
if (args.includes("--final")) {
  await db.from("fantasy_entries").update({ status: "final" }).eq("gw", GW).eq("user_id", userId);
  await db.from("fantasy_gameweeks").update({ status: "final" }).eq("gw", GW);
  console.log("staged gameweek promoted to final");
  process.exit(0);
}
if (!args.includes("--yes")) {
  console.error("refusing to write without --yes");
  process.exit(1);
}

const call = async (path, body, method) => {
  const res = await fetch(`${BASE}/api/fantasy/${path}`, {
    method: method ?? (body !== undefined ? "POST" : "GET"),
    headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};

await clean();

// 1. the staged gameweek
const deadline = new Date(Date.now() - 2 * 3600_000).toISOString();
const { error: insErr } = await db.from("fantasy_gameweeks").insert({
  gw: GW, season: "LIVE FIXTURE", mode: "live",
  window_start: WINDOW_START, window_end: WINDOW_END,
  deadline, status: "open", sm_season_id: SM_SEASON,
});
if (insErr) { console.error("insert failed:", insErr.message); process.exit(1); }
console.log(`gameweek ${GW} staged, deadline 2h ago`);

// 2. a squad, and mute the comms the finalise would fire
const pool = (await call("pool")).json.players;

/** Spend UP, not down.
 *
 *  A cheapest-first squad is the wrong fixture for this: the cheapest players in
 *  the 26/27 pool are mostly newly promoted or newly signed, so almost none of
 *  them appear in a November 2025 match and the live screen renders fourteen
 *  "still to play" rows and nothing else. Established, expensive players actually
 *  featured. Greedy price-descending, holding back just enough budget to fill the
 *  slots still empty. */
const QUOTA = { GK: 2, DEF: 5, MID: 5, FWD: 3 };
const cheapestOf = (pos) => Math.min(...pool.filter((p) => p.pos === pos).map((p) => Math.round(p.price * 10)));
const FLOOR = Object.fromEntries(Object.keys(QUOTA).map((pos) => [pos, cheapestOf(pos)]));

const picked = [];
const clubCount = {};
const need = { ...QUOTA };
let budget = 1000;
// Forwards and midfielders first — that's where the price and the points are.
for (const pos of ["FWD", "MID", "DEF", "GK"]) {
  for (let slot = 0; slot < QUOTA[pos]; slot++) {
    need[pos]--;
    const reserve = Object.entries(need).reduce((sum, [p, n]) => sum + n * FLOOR[p], 0);
    const affordable = budget - reserve;
    const pick = pool
      .filter((p) => p.pos === pos && !picked.includes(p.id) &&
        Math.round(p.price * 10) <= affordable && (clubCount[p.clubId] ?? 0) < 3)
      .sort((a, b) => b.price - a.price)[0];
    if (!pick) { console.error(`could not fill ${pos} slot ${slot + 1}`); process.exit(1); }
    picked.push(pick.id);
    clubCount[pick.clubId] = (clubCount[pick.clubId] ?? 0) + 1;
    budget -= Math.round(pick.price * 10);
  }
}
const built = await call("squad", { pickIds: picked });
if (built.status !== 200) { console.error("squad build failed:", built.json); process.exit(1); }
console.log(`squad built, £${(1000 - budget) / 10}m spent`);

const monthParts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit" })
  .formatToParts(new Date(deadline));
const monthKey = `${monthParts.find((p) => p.type === "year").value}-${monthParts.find((p) => p.type === "month").value}`;
const { data: leagues } = await db.from("fantasy_leagues").select("id");
const { data: members } = await db.from("fantasy_league_members").select("league_id, user_id");
const claims = [{ user_id: userId, key: `fantasy-result:${GW}` }];
for (const l of leagues ?? [])
  for (const m of (members ?? []).filter((x) => x.league_id === l.id))
    claims.push({ user_id: m.user_id, key: `fantasy-month:${l.id}:${monthKey}` });
await db.from("notification_log").insert(claims);
console.log(`${claims.length} notification keys muted`);

// 3. let the real tick do the work
const tick = await fetch(`${BASE}/api/cron/fantasy-tick`, {
  headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
});
const report = (await tick.json()).report?.filter((r) => r.gw === GW) ?? [];
console.log("tick:", report.map((r) => `${r.action} — ${r.detail}`).join(" | "));

// 4. wind it back to mid-weekend
const { data: entry } = await db.from("fantasy_entries")
  .select("points, points_breakdown").eq("gw", GW).eq("user_id", userId).single();
const blanks = (entry.points_breakdown ?? []).filter((b) => b.points === 0).slice(0, STILL_TO_PLAY).map((b) => b.id);
if (blanks.length) {
  await db.from("fantasy_player_scores").delete().eq("gw", GW).in("player_id", blanks);
}
await db.from("fantasy_entries").update({ status: "locked" }).eq("gw", GW).eq("user_id", userId);
await db.from("fantasy_gameweeks").update({ status: "locked" }).eq("gw", GW);

const state = await call("state");
const r = state.json.entry?.result;
console.log(`\nstaged: gameweek ${GW} · points ${r?.points} · provisional=${r?.provisional}`);
console.log(`        ${r?.reported?.length ?? 0} of 15 picks reported, ${blanks.length} wound back to "still to play"`);
console.log(`\nopen ${BASE}/fantasy?fantasy=preview signed in as the bot to look at it`);
