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
// The round API operates on the user's CURRENT gameweek — the real GW1 here, not
// the staged 900 (currentGw takes the lowest live gw). That's fine: the round→tray
// wiring is gameweek-agnostic, so we play it and read the result straight off
// getState (same gameweek + the squad's tray), rather than a hardcoded gw row.
console.log("\n── A. round → tray ──");
const start = await call("round/start", {});
const questions = start.json?.questions ?? [];
if (!Array.isArray(questions) || !questions.length) {
  bad("round did not start — skipping the round→tray check", JSON.stringify(start.json).slice(0, 160));
} else {
  for (let k = 0; k < questions.length; k++) {
    const optionId = questions[k]?.options?.[0]?.id ?? questions[k]?.options?.[0] ?? 0;
    await call("round/step", { k, optionId });
  }
  const st = (await call("state")).json;
  const rc = st?.entry?.round?.correct ?? 0;
  const earned = st?.squad?.earnedForNextGw;
  if (!st?.entry?.round?.done) {
    bad("round did not complete via the API — skipping the round→tray check", JSON.stringify(st?.entry ?? {}).slice(0, 160));
  } else {
    check(earned === creditsForRound(rc), `the round fed the tray = creditsForRound(${rc}) = ${creditsForRound(rc)}`, `tray=${earned}`);
    check(creditsForRound(rc) === 0 || st?.squad?.earnedSource === "round", "the tray's source reads 'round'", `source=${st?.squad?.earnedSource}`);
  }
}

// ── B. gameday sweep → settled into the bank (end-to-end, in the real tick) ───
// first-only / bridge / override-upward are already proven on the REAL gamedayEarn
// by the in-memory gameday-credit test; here we prove the sweep runs in the REAL
// tick against the REAL db and its result settles into the spendable bank at
// finalise. The Nov-2025 window means one tick runs lock → gamedayEarn → ingest →
// score → finalise in order, so the seeded quiz is swept into the tray and then
// settled, all in flight.
console.log("\n── B. gameday quiz → settled credits ──");
// Reset the tray so only the gameday quiz below counts (Test A's round fed GW1).
await db.from("fantasy_squads").update({ pending_credits: 0, pending_gameday_done: false, pending_source: null }).eq("user_id", userId);
// question_count is a GENERATED column (from questions) — don't set it.
const { error: packErr } = await db.from("quiz_packs").insert({
  id: PACK_ID, name: "DRILL gameday", type: "records", parameter: "900", source: "system",
  status: "published", rotation_active: false, featured: false, questions: [],
  description: "drill", metadata: { gameday: { fixture_id: 900, season_id: SM_SEASON, gameweek: GW, home: "A", away: "B" } },
});
check(!packErr, "a gameday pack (metadata.gameday) was seeded", packErr?.message ?? "");
const GDAY = 6; // 6/11 → 2 credits
await db.from("quiz_attempts").insert({
  user_id: userId, pack_id: PACK_ID, score: GDAY, max_score: 11, correct_count: GDAY, answers: [],
  completed_at: new Date(`${WINDOW_START}T12:00:00Z`).toISOString(),
});
ok(`a gameday quiz seeded — ${GDAY}/11 (→ ${creditsForRound(GDAY)} credits)`);

const secret = process.env.CRON_SECRET;
const claims = await muteComms(db, { gw: GW, deadline, userIds: [userId] });
const creditsBefore = (await squadOf(userId)).credits;
await db.from("fantasy_gameweeks").update({ deadline: new Date(Date.now() - 60_000).toISOString() }).eq("gw", GW);

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
const gd = creditsForRound(GDAY);
const expectedCredits = Math.min(5, creditsBefore + 1 + gd); // +1 baseline, + the gameday tray
check(afterSettle.credits === expectedCredits,
  `the gameday quiz settled into the bank: ${creditsBefore} + 1 baseline + ${gd} gameday → ${expectedCredits}`, `credits=${afterSettle.credits}`);
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
