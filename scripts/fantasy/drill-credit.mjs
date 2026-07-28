/**
 * THE CREDIT-REWRITE DRILL — prove the "earned for next week" tray on real code
 * and real data, before gameweek 1 (21 Aug), the way rehearse-tick.mjs proved the
 * state machine.
 *
 * What it exercises (the parts the unit tests can't reach — the DB sweep and the
 * settlement composition):
 *   A. ROUND → TRAY. The bot plays the neutral round through the real API; the
 *      tray (pending_credits) must equal creditsForRound(round_correct). Proves
 *      completeRound now feeds the tray instead of banking immediately.
 *   B. GAMEDAY SWEEP → TRAY, first-only. A gameday pack (metadata.gameday) plus
 *      two attempts (a lower one first, a higher one second) are seeded; one tick
 *      runs the sweep. The tray must rise to the FIRST attempt's value and lock,
 *      and must NOT jump to the higher second one. Proves the bridge fix
 *      (metadata.gameday, not the dead metadata.halftime) AND first-only.
 *   C. SETTLEMENT. Ticking to `final` must pour baseline + tray into the spendable
 *      bank (credits = min(5, before + 1 + tray)) and reset the tray to zero.
 *   D. IDEMPOTENCY. A re-tick settles nobody twice.
 *
 * Safe like rehearse-tick: a throwaway gameweek 900 (never collides with the real
 * 1-38; currentGw still hands real users gameweek 1), the health-BOT account (not
 * a real person), every notification pre-claimed via muteComms, and everything it
 * writes it deletes.
 *
 * PREREQUISITES (this is a LIVE drill — it hits a running server + the DB):
 *   1. Migrations 212 + 213 applied to the target DB (additive/safe — old code
 *      ignores the columns, so applying them early carries no risk).
 *   2. A dev server running THIS branch at REHEARSE_BASE (default :3411).
 *   3. .env.local with the Supabase service role, CRON_SECRET, and the bot creds.
 *
 * Run:
 *   node --env-file=.env.local scripts/fantasy/drill-credit.mjs --yes
 *   node --env-file=.env.local scripts/fantasy/drill-credit.mjs --clean
 */
import { createClient } from "@supabase/supabase-js";
import { signInBot } from "../health/lib/auth.mjs";
import { muteComms, unmuteComms } from "./lib/mute-comms.mjs";

const GW = 900;
const WINDOW_START = "2025-11-08";
const WINDOW_END = "2025-11-10";
const SM_SEASON = 25583;
const BASE = process.env.REHEARSE_BASE ?? "http://localhost:3411";
const MAX_TICKS = 8;
const PACK_ID = "00000000-0000-4900-a900-000000000900"; // fixed, drill-owned uuid

// Same scale as engine.creditsForRound (3/6/9/11 → 1/2/3/4). Inlined so the .mjs
// needs no TS build; if this drifts from the engine, test A/B/C will disagree.
const creditsForRound = (c) => (c >= 11 ? 4 : c >= 9 ? 3 : c >= 6 ? 2 : c >= 3 ? 1 : 0);

const args = process.argv.slice(2);
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
const squadOf = async (userId) =>
  (await db.from("fantasy_squads").select("credits, pending_credits, pending_gameday_done, pending_source").eq("user_id", userId).single()).data;

async function teardown(userId) {
  await db.from("quiz_attempts").delete().eq("pack_id", PACK_ID);
  await db.from("quiz_packs").delete().eq("id", PACK_ID);
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
const { data: realGws } = await db.from("fantasy_gameweeks").select("gw, status").lte("gw", 38);
const started = (realGws ?? []).filter((g) => g.status !== "open");
check(started.length === 0, "no real gameweek has started yet, safe to drill",
  started.length ? `${started.length} already moved` : "all 38 open");
if (started.length) process.exit(1);

// Schema present? (migrations 212/213). Fail loud rather than mid-drill.
const { error: colErr } = await db.from("fantasy_squads").select("pending_credits").limit(1);
check(!colErr, "the pending_credits column exists (migrations 212/213 applied)", colErr?.message ?? "");
if (colErr) process.exit(1);

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

// ── 1. stage the gameweek OPEN, deadline in the near future ──────────────────
// Open (deadline ahead) so the round can actually be played, unlike rehearse-tick.
console.log("\n── 1. stage ──");
const deadline = new Date(Date.now() + 15 * 60_000).toISOString();
const { error: insErr } = await db.from("fantasy_gameweeks").insert({
  gw: GW, season: "DRILL", mode: "live",
  window_start: WINDOW_START, window_end: WINDOW_END,
  deadline, status: "open", sm_season_id: SM_SEASON,
});
check(!insErr, `gameweek ${GW} staged OPEN, deadline in 15 minutes`, insErr?.message ?? "");
if (insErr) process.exit(1);

const pool = (await call("pool")).json.players;
const clubCount = {};
const take = (pos, n) => {
  const out = [];
  for (const p of pool.filter((x) => x.pos === pos).sort((a, b) => a.price - b.price)) {
    if (out.length >= n) break;
    if ((clubCount[p.clubId] ?? 0) >= 2) continue;
    clubCount[p.clubId] = (clubCount[p.clubId] ?? 0) + 1;
    out.push(p.id);
  }
  return out;
};
const built = await call("squad", { pickIds: [...take("GK", 2), ...take("DEF", 5), ...take("MID", 5), ...take("FWD", 3)] });
check(built.status === 200, "test squad built", built.status === 200 ? "" : JSON.stringify(built.json));
if (built.status !== 200) process.exit(1);

// ── A. round → tray ──────────────────────────────────────────────────────────
console.log("\n── A. round → tray ──");
const start = await call("round/start", {});
const questions = start.json?.questions ?? [];
if (!Array.isArray(questions) || !questions.length) {
  bad("round did not start — cannot test the round→tray path", JSON.stringify(start.json).slice(0, 120));
} else {
  for (let k = 0; k < questions.length; k++) {
    const optionId = questions[k]?.options?.[0]?.id ?? questions[k]?.options?.[0] ?? 0;
    await call("round/step", { k, optionId });
  }
  const entry = (await db.from("fantasy_entries").select("round_correct, round_done_at").eq("gw", GW).eq("user_id", userId).single()).data;
  const sq = await squadOf(userId);
  const expected = creditsForRound(entry.round_correct ?? 0);
  check(!!entry.round_done_at, "the round completed through the real API", `${entry.round_correct}/11`);
  check(sq.pending_credits === expected,
    `the round fed the tray = creditsForRound(${entry.round_correct}) = ${expected}`, `tray=${sq.pending_credits}`);
  check(expected === 0 || sq.pending_source === "round", "and the tray's source reads 'round'", `source=${sq.pending_source}`);
}

// ── B. gameday sweep → tray (bridge fix + first-only) ─────────────────────────
// Control the starting tray so the assertion is deterministic regardless of the
// round score above: a modest 0 to start, then a LOWER gameday quiz first and a
// HIGHER one second. First-only means the tray takes the first, never the second.
console.log("\n── B. gameday sweep (bridge + first-only) ──");
await db.from("fantasy_squads").update({ pending_credits: 0, pending_gameday_done: false, pending_source: null }).eq("user_id", userId);
const { error: packErr } = await db.from("quiz_packs").insert({
  id: PACK_ID, name: "DRILL gameday", type: "club", parameter: "900", source: "drill",
  status: "published", rotation_active: false, featured: false, question_count: 11, questions: [],
  description: "drill", metadata: { gameday: { fixture_id: 900, season_id: SM_SEASON, gameweek: GW, home: "A", away: "B" } },
});
check(!packErr, "a gameday pack (metadata.gameday) was seeded", packErr?.message ?? "");
const t0 = new Date(new Date(`${WINDOW_START}T12:00:00Z`).getTime());
const FIRST = 6, SECOND = 11; // creditsForRound: 6→2, 11→4
await db.from("quiz_attempts").insert([
  { user_id: userId, pack_id: PACK_ID, score: FIRST, max_score: 11, correct_count: FIRST, answers: [], completed_at: t0.toISOString() },
  { user_id: userId, pack_id: PACK_ID, score: SECOND, max_score: 11, correct_count: SECOND, answers: [], completed_at: new Date(t0.getTime() + 60_000).toISOString() },
]);
ok(`two gameday attempts seeded — first ${FIRST}/11 (→${creditsForRound(FIRST)}), then ${SECOND}/11 (→${creditsForRound(SECOND)})`);

// mute, then move the deadline into the past AND blank the feed season (sm 0 → no
// fixtures → ingest holds). One tick then locks the gw and runs the gameday sweep
// (which fires BEFORE ingest), but HOLDS at `locked` instead of racing on to
// finalise — so we can observe the tray at its post-sweep value before Test C
// settles it. Nov-2025 is far enough in the past that a live feed would otherwise
// lock→score→finalise in a single tick.
const claims = await muteComms(db, { gw: GW, deadline, userIds: [userId] });
await db.from("fantasy_gameweeks")
  .update({ deadline: new Date(Date.now() - 60_000).toISOString(), sm_season_id: 0 }).eq("gw", GW);
const secret = process.env.CRON_SECRET;
await fetch(`${BASE}/api/cron/fantasy-tick`, { headers: { Authorization: `Bearer ${secret}` } });
const afterSweep = await squadOf(userId);
check((await db.from("fantasy_gameweeks").select("status").eq("gw", GW).single()).data?.status === "locked",
  "the gameweek held at 'locked' (feed blanked) so the tray is observable pre-settlement");
check(afterSweep.pending_gameday_done === true, "the gameday slot locked (a quiz counted this cycle)");
check(afterSweep.pending_credits === creditsForRound(FIRST),
  `the tray took the FIRST quiz (${creditsForRound(FIRST)}), not the higher second (${creditsForRound(SECOND)})`,
  `tray=${afterSweep.pending_credits}`);
check(afterSweep.pending_source === "gameday", "the tray's source reads 'gameday'", `source=${afterSweep.pending_source}`);
const creditsBefore = afterSweep.credits;
const trayBefore = afterSweep.pending_credits;

// ── C. settlement — restore the feed, tick to final ──────────────────────────
// Point the gameweek back at the real completed Nov-2025 weekend so ingest +
// scoring do real work and the state machine reaches finalise, where the tray
// settles. The gameday sweep runs again but finds the slot locked, so nothing
// double-counts.
console.log("\n── C. settlement ──");
await db.from("fantasy_gameweeks").update({ sm_season_id: SM_SEASON }).eq("gw", GW);
let status = (await db.from("fantasy_gameweeks").select("status").eq("gw", GW).single()).data?.status;
for (let i = 1; i <= MAX_TICKS && status !== "final"; i++) {
  const res = await fetch(`${BASE}/api/cron/fantasy-tick`, { headers: { Authorization: `Bearer ${secret}` } });
  const body = await res.json().catch(() => ({}));
  const mine = (body.report ?? []).filter((r) => r.gw === GW);
  console.log(`  tick ${i}: ${mine.map((r) => `${r.action} — ${r.detail}`).join(" | ") || "(nothing)"}`);
  status = (await db.from("fantasy_gameweeks").select("status").eq("gw", GW).single()).data?.status;
}
check(status === "final", "the gameweek finalised", `status=${status}`);
const afterSettle = await squadOf(userId);
const expectedCredits = Math.min(5, creditsBefore + 1 + trayBefore); // +1 baseline, + tray
check(afterSettle.credits === expectedCredits,
  `settled into the bank: ${creditsBefore} + 1 baseline + ${trayBefore} tray → ${expectedCredits}`, `credits=${afterSettle.credits}`);
check(afterSettle.pending_credits === 0, "the tray reset to zero for the new cycle", `tray=${afterSettle.pending_credits}`);
check(afterSettle.pending_gameday_done === false, "and the gameday slot reopened");

// ── D. idempotency ───────────────────────────────────────────────────────────
console.log("\n── D. idempotency ──");
await fetch(`${BASE}/api/cron/fantasy-tick`, { headers: { Authorization: `Bearer ${secret}` } });
const afterTwice = await squadOf(userId);
check(afterTwice.credits === afterSettle.credits, "a re-tick settles nobody twice", `credits=${afterTwice.credits}`);

// ── tear down ────────────────────────────────────────────────────────────────
console.log("\n── tear down ──");
await unmuteComms(db, claims);
await db.from("notification_log").delete().eq("key", `fantasy-result:${GW}`);
await teardown(userId);
const { count: gws } = await db.from("fantasy_gameweeks").select("*", { count: "exact", head: true });
check(gws === 38, "drill removed, 38 real gameweeks intact", `gameweeks=${gws}`);

console.log(failed ? `\n${failed} CHECK(S) FAILED` : "\nCREDIT DRILL PASSED — the tray earns, sweeps first-only, and settles");
process.exit(failed ? 1 : 0);
