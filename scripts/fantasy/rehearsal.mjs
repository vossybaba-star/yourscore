#!/usr/bin/env node
/**
 * Captain Assist end-to-end rehearsal.
 *
 * Drives the REAL modules (emitted from src/lib/fantasy) against the REAL
 * database, because a rehearsal against mocks proves nothing. Two safety rails
 * make that acceptable:
 *
 *   1. every row it writes is flagged is_rehearsal, and every evaluation view
 *      excludes those rows — a dry run can never contaminate the evidence;
 *   2. it is scoped to one synthetic user id and a synthetic gameweek, so it
 *      never touches a real squad or the live gameweek.
 *
 * The synthetic squad row is removed at the end. Rows in the append-only tables
 * cannot be removed by design, which is exactly why they are flagged instead.
 *
 * Run:
 *   npx tsc -p .tmp-rehearsal-tsconfig.json
 *   node --env-file=.env.local scripts/fantasy/rehearsal.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const REF = "mznvuswzgkaupvaqznkm";
const url = `https://${REF}.supabase.co`;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) { console.error("SUPABASE_SERVICE_ROLE_KEY not set"); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

const { getCaptainAssist, applyCaptainRecommendation } = await import("../../.tmp-rehearsal-js/captainAssist.js");
const { freezeShadow, captureDeadlineSquads, scoreShadow } = await import("../../.tmp-rehearsal-js/captainShadow.js");

const REHEARSAL_GW = 90;           // far outside any real gameweek
const NOFIXTURE_GW = 91;           // deliberately never given fixture data
const results = [];
let failures = 0;

function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function seedSnapshot(userId, { withFixtures, blankTeam = null, gw = REHEARSAL_GW }) {
  const capturedAt = new Date().toISOString();
  const deadline = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1h out
  // Four players across two clubs; club 2 can be made blank on demand.
  const players = [
    { player_id: 900001, web_name: "Alpha", team: 1, ep: 6.0, pos: "MID" },
    { player_id: 900002, web_name: "Bravo", team: 1, ep: 5.0, pos: "MID" },
    { player_id: 900003, web_name: "Charlie", team: 2, ep: 4.0, pos: "FWD" },
    { player_id: 900004, web_name: "Delta", team: 2, ep: 3.0, pos: "DEF" },
  ];
  const { error: snapErr } = await db.from("fantasy_fpl_snapshot").insert(players.map((p) => ({
    captured_at: capturedAt, current_event: null, next_event: gw, next_deadline: deadline,
    player_id: p.player_id, web_name: p.web_name, team: p.team, position: p.pos,
    now_cost: 50, selected_by_percent: 10, ep_next: p.ep, form: p.player_id === 900003 ? 9.9 : 1.0,
    status: "a", news: "", is_rehearsal: true,
  })));
  if (snapErr) throw new Error(`snapshot insert failed: ${snapErr.message}`);
  if (withFixtures) {
    const fx = [{ fixture_id: 990001, event: gw, team_h: 1, team_a: 3, team_h_name: "Alphaton", team_a_name: "Gamma City" }];
    if (blankTeam !== 2) fx.push({ fixture_id: 990002, event: gw, team_h: 4, team_a: 2, team_h_name: "Delta Town", team_a_name: "Bravo Rovers" });
    await db.from("fantasy_fixture_snapshot").insert(fx.map((f) => ({ ...f, captured_at: capturedAt, is_rehearsal: true })));
  }
  return { capturedAt, deadline, players };
}

async function cleanup(userId) {
  await db.from("fantasy_squads").delete().eq("user_id", userId);
  await db.from("fantasy_player_scores").delete().eq("gw", REHEARSAL_GW);
  await db.auth.admin.deleteUser(userId);   // cascade removes anything left behind
}

// fantasy_squads.user_id is FK-constrained to auth.users, so the rehearsal needs
// a real (throwaway) auth user. Deleted at the end; ON DELETE CASCADE takes the
// squad with it.
const email = `rehearsal+${randomUUID()}@yourscore.invalid`;
const { data: created, error: userErr } = await db.auth.admin.createUser({
  email, password: randomUUID(), email_confirm: true,
});
if (userErr || !created?.user?.id) { console.error("could not create rehearsal user:", userErr?.message); process.exit(1); }
const userId = created.user.id;
console.log(`rehearsal user ${userId}, gameweek ${REHEARSAL_GW}\n`);

try {
  // ---------- 1-2: normal single fixture, and a double ----------
  const seed = await seedSnapshot(userId, { withFixtures: true });
  const { error: squadErr } = await db.from("fantasy_squads").insert({
    user_id: userId, xi: [900001, 900002, 900003, 900004], bench: [],
    captain: 900003, vice: 900004, picks: {}, bank_tenths: 0, credits: 0, version: 1, created_gw: REHEARSAL_GW,
  });
  if (squadErr) throw new Error(`squad insert failed: ${squadErr.message}`);

  const rec1 = await getCaptainAssist(db, userId, { ignoreFlag: true, isRehearsal: true });
  check("1. single-fixture recommendation generated", rec1.available === true,
    rec1.available ? `captain=${rec1.captain.name} fixture="${rec1.evidence.find((e) => e.label === "Fixture")?.value ?? "-"}"` : rec1.reason);
  check("2. fixture label rendered from ids", !!rec1.evidence?.some((e) => e.label === "Fixture" && /Home to|Away at/.test(e.value)));

  // ---------- 2b: a double gameweek shows BOTH fixtures ----------
  {
    const capturedAt = new Date().toISOString();
    const deadline = new Date(Date.now() + 3600e3).toISOString();
    await db.from("fantasy_fpl_snapshot").insert([
      { captured_at: capturedAt, next_event: REHEARSAL_GW, next_deadline: deadline, player_id: 900001,
        web_name: "Alpha", team: 1, position: "MID", now_cost: 50, ep_next: 6, form: 1, status: "a", is_rehearsal: true },
      { captured_at: capturedAt, next_event: REHEARSAL_GW, next_deadline: deadline, player_id: 900002,
        web_name: "Bravo", team: 1, position: "MID", now_cost: 50, ep_next: 5, form: 1, status: "a", is_rehearsal: true },
      { captured_at: capturedAt, next_event: REHEARSAL_GW, next_deadline: deadline, player_id: 900003,
        web_name: "Charlie", team: 2, position: "FWD", now_cost: 50, ep_next: 4, form: 1, status: "a", is_rehearsal: true },
      { captured_at: capturedAt, next_event: REHEARSAL_GW, next_deadline: deadline, player_id: 900004,
        web_name: "Delta", team: 2, position: "DEF", now_cost: 50, ep_next: 3, form: 1, status: "a", is_rehearsal: true },
    ]);
    // club 1 plays TWICE this gameweek
    await db.from("fantasy_fixture_snapshot").insert([
      { captured_at: capturedAt, fixture_id: 990010, event: REHEARSAL_GW, team_h: 1, team_a: 3,
        team_h_name: "Alphaton", team_a_name: "Gamma City", is_rehearsal: true },
      { captured_at: capturedAt, fixture_id: 990011, event: REHEARSAL_GW, team_h: 4, team_a: 1,
        team_h_name: "Delta Town", team_a_name: "Alphaton", is_rehearsal: true },
      { captured_at: capturedAt, fixture_id: 990012, event: REHEARSAL_GW, team_h: 4, team_a: 2,
        team_h_name: "Delta Town", team_a_name: "Bravo Rovers", is_rehearsal: true },
    ]);
    const recDouble = await getCaptainAssist(db, userId, { ignoreFlag: true, isRehearsal: true });
    const label = recDouble.evidence?.find((e) => e.label === "Fixture")?.value ?? "";
    check("2b. double gameweek shows BOTH fixtures",
      recDouble.available === true && label.includes("·") && /Home to .*·.*Away at |Away at .*·.*Home to /.test(label),
      `label="${label}"`);
  }

  // ---------- 3: a confirmed blank player cannot be recommended ----------
  const seedBlank = await seedSnapshot(userId, { withFixtures: true, blankTeam: 2 });
  const recBlank = await getCaptainAssist(db, userId, { ignoreFlag: true, isRehearsal: true });
  const blankIds = [900003, 900004];
  check("3. confirmed-blank player not recommended",
    recBlank.available === true && !blankIds.includes(recBlank.captain.id),
    recBlank.available ? `captain=${recBlank.captain.name}` : recBlank.reason);

  // ---------- 4: missing fixture data => unknown, not a false blank ----------
  await seedSnapshot(userId, { withFixtures: false, gw: NOFIXTURE_GW });
  const recUnknown = await getCaptainAssist(db, userId, { ignoreFlag: true, isRehearsal: true });
  check("4. missing fixture data => unknown (not false blank/fixture)",
    recUnknown.available === true && recUnknown.fixtureStatus === "unknown" && recUnknown.canApply === false,
    recUnknown.available ? `status=${recUnknown.fixtureStatus} canApply=${recUnknown.canApply} confidence=${recUnknown.confidence}` : recUnknown.reason);

  // ---------- 4b: applying is blocked server-side while unknown ----------
  const blocked = await applyCaptainRecommendation(db, userId, {
    recommendationId: recUnknown.recommendationId, applyCaptain: true, applyVice: false,
  });
  check("4b. apply blocked server-side while fixtures unknown",
    blocked.ok === false && blocked.code === "refresh_required", blocked.message ?? "");

  // ---------- 7: a refreshed recommendation gets a NEW immutable id ----------
  await seedSnapshot(userId, { withFixtures: true });   // back to the GW90 context
  const rec2 = await getCaptainAssist(db, userId, { ignoreFlag: true, isRehearsal: true });
  check("7. refreshed recommendation has a new immutable id",
    rec2.available && rec1.available && rec2.recommendationId !== rec1.recommendationId);

  // ---------- 6: superseded history preserved via freeze ----------
  const override = { gw: REHEARSAL_GW, deadline: seed.deadline };
  await freezeShadow(db, { isRehearsal: true, onlyUserIds: [userId], override });
  await seedSnapshot(userId, { withFixtures: true });
  await freezeShadow(db, { isRehearsal: true, onlyUserIds: [userId], override });
  const { data: recs } = await db.from("fantasy_captain_recommendation")
    .select("id, status, recommendation_version, superseded_by_recommendation_id, change_reason")
    .eq("user_id", userId).order("created_at", { ascending: true });
  const superseded = (recs ?? []).filter((r) => r.status === "superseded");
  check("6. earlier recommendation preserved as superseded (history kept)",
    superseded.length >= 1 && superseded.every((r) => r.superseded_by_recommendation_id && r.change_reason),
    `${(recs ?? []).length} recommendations, ${superseded.length} superseded`);

  // ---------- 14: every step safe when run twice ----------
  const before = (await db.from("fantasy_captain_shadow").select("id").eq("user_id", userId)).data?.length ?? 0;
  await freezeShadow(db, { isRehearsal: true, onlyUserIds: [userId], override });
  const after = (await db.from("fantasy_captain_shadow").select("id").eq("user_id", userId)).data?.length ?? 0;
  check("14. freeze is safe when run twice (no duplicate shadow rows)", before === after && after === 1,
    `rows before=${before} after=${after}`);

  // ---------- 5: fixture postponement after generation ----------
  const recBefore = await getCaptainAssist(db, userId, { ignoreFlag: true, isRehearsal: true });
  // the fixture set changes: capture a NEWER snapshot where club 1 no longer plays
  const capturedAt2 = new Date(Date.now() + 1000).toISOString();
  await db.from("fantasy_fixture_snapshot").insert([{
    captured_at: capturedAt2, fixture_id: 990003, event: REHEARSAL_GW,
    team_h: 4, team_a: 2, team_h_name: "Delta Town", team_a_name: "Bravo Rovers", is_rehearsal: true,
  }]);
  const postponed = await applyCaptainRecommendation(db, userId, {
    recommendationId: recBefore.recommendationId, applyCaptain: true, applyVice: false,
  });
  check("5. postponement after generation returns fixture_context_changed",
    postponed.ok === false && postponed.code === "refresh_required", postponed.message ?? "");
  const { data: after5 } = await db.from("fantasy_captain_recommendation")
    .select("status, change_reason").eq("id", recBefore.recommendationId).maybeSingle();
  check("5b. that recommendation is preserved as superseded with a reason",
    after5?.status === "superseded" && after5?.change_reason === "fixture_context_changed",
    `status=${after5?.status} reason=${after5?.change_reason}`);

  // ---------- 9: deadline squad captures what the user actually selected ----------
  await db.from("fantasy_squads").update({ captain: 900002, vice: 900001 }).eq("user_id", userId);
  const past = { gw: REHEARSAL_GW, deadline: new Date(Date.now() - 60_000).toISOString() };
  const dl = await captureDeadlineSquads(db, { isRehearsal: true, onlyUserIds: [userId], override: past });
  const { data: ds } = await db.from("fantasy_deadline_squad")
    .select("captain, vice").eq("user_id", userId).eq("gameweek", REHEARSAL_GW).maybeSingle();
  check("9. deadline squad captures the user's ACTUAL final choice",
    ds?.captain === 900002 && ds?.vice === 900001, `captured captain=${ds?.captain} vice=${ds?.vice}`);

  // ---------- 13b: a post-deadline run cannot create an official recommendation ----------
  {
    const pastDl = { gw: REHEARSAL_GW, deadline: new Date(Date.now() - 60_000).toISOString() };
    const after = await freezeShadow(db, { isRehearsal: true, onlyUserIds: [userId], override: pastDl });
    check("13b. freeze refuses to run after the deadline", after.written === 0,
      `written=${after.written} (must be 0)`);
  }

  // ---------- 14b: deadline capture is safe when run twice ----------
  {
    const past = { gw: REHEARSAL_GW, deadline: new Date(Date.now() - 60_000).toISOString() };
    const { data: b } = await db.from("fantasy_deadline_squad").select("id").eq("user_id", userId).eq("gameweek", REHEARSAL_GW);
    await captureDeadlineSquads(db, { isRehearsal: true, onlyUserIds: [userId], override: past });
    const { data: a } = await db.from("fantasy_deadline_squad").select("id").eq("user_id", userId).eq("gameweek", REHEARSAL_GW);
    check("14b. deadline capture safe when run twice (immutable, no duplicate)",
      (b ?? []).length === 1 && (a ?? []).length === 1, `before=${(b ?? []).length} after=${(a ?? []).length}`);
  }

  // ---------- 11: vice fallback applied on BOTH sides ----------
  {
    // recommended captain did not appear -> his vice should captain instead.
    // `facts` is NOT NULL with no default — omitting it fails the insert.
    const { error: scoreErr } = await db.from("fantasy_player_scores").upsert([
      { gw: REHEARSAL_GW, player_id: 900001, minutes: 0, points: 0, facts: {} },   // rec captain: blank
      { gw: REHEARSAL_GW, player_id: 900002, minutes: 90, points: 8, facts: {} },  // rec vice: played
      { gw: REHEARSAL_GW, player_id: 900003, minutes: 90, points: 2, facts: {} },  // user captain: played
      { gw: REHEARSAL_GW, player_id: 900004, minutes: 90, points: 1, facts: {} },  // user vice
    ], { onConflict: "gw,player_id" });
    if (scoreErr) throw new Error(`player scores upsert failed: ${scoreErr.message}`);
    await db.from("fantasy_captain_shadow").update({
      status: "final_frozen", scored_at: null,
      recommended_captain: 900001, recommended_vice: 900002,
      deadline_captain: 900003, deadline_vice: 900004,
    }).eq("user_id", userId).eq("gameweek", REHEARSAL_GW);

    const r1 = await scoreShadow(db, { forceFinalGameweeks: [REHEARSAL_GW] });
    const { data: row } = await db.from("fantasy_captain_shadow")
      .select("recommended_effective_points, user_effective_points, difference, recommended_vice_activated, user_vice_activated, recommended_appeared")
      .eq("user_id", userId).eq("gameweek", REHEARSAL_GW).maybeSingle();
    check("11. vice fallback applied on BOTH sides of the counterfactual",
      row?.recommended_effective_points === 8 && row?.user_effective_points === 2 &&
      row?.difference === 6 && row?.recommended_vice_activated === true &&
      row?.user_vice_activated === false && row?.recommended_appeared === false,
      `rec_eff=${row?.recommended_effective_points} user_eff=${row?.user_effective_points} diff=${row?.difference} rec_vice_used=${row?.recommended_vice_activated}`);

    // ---------- 14c: scoring is safe when run twice ----------
    const r2 = await scoreShadow(db, { forceFinalGameweeks: [REHEARSAL_GW] });
    const { data: row2 } = await db.from("fantasy_captain_shadow")
      .select("difference, status").eq("user_id", userId).eq("gameweek", REHEARSAL_GW).maybeSingle();
    check("14c. scoring safe when run twice (no double-count, idempotent)",
      row2?.difference === 6 && row2?.status === "scored" && r2.scored === 0,
      `diff=${row2?.difference} status=${row2?.status} second_run_scored=${r2.scored} (first=${r1.scored})`);
  }

  // ---------- 8: only the latest valid pre-deadline rec becomes final_frozen ----------
  const { data: finals } = await db.from("fantasy_captain_recommendation")
    .select("id, status").eq("user_id", userId).eq("status", "final_frozen");
  check("8. exactly one recommendation is final_frozen", (finals ?? []).length === 1,
    `${(finals ?? []).length} final_frozen`);

  // ---------- 12: control users still get invisible shadow generation ----------
  const { data: arm } = await db.from("fantasy_captain_experiment")
    .select("arm, assignment_version, experiment_id").eq("user_id", userId).maybeSingle();
  const { data: shadowRow } = await db.from("fantasy_captain_shadow")
    .select("exposure, recommended_captain").eq("user_id", userId).maybeSingle();
  check("12. shadow generated regardless of arm (control included)",
    !!arm?.arm && !!shadowRow?.recommended_captain,
    `arm=${arm?.arm} exposure=${shadowRow?.exposure}`);

  // ---------- 10: scoring waits for finished && data_checked ----------
  const scored = await scoreShadow(db);
  check("10. scoring waits for official finalisation (gameweek not final)",
    !scored.gameweeks.includes(REHEARSAL_GW),
    `waiting=${JSON.stringify(scored.waiting)} scored_gws=${JSON.stringify(scored.gameweeks)}`);

  // ---------- 13: rehearsal rows cannot enter the evaluation views ----------
  const { data: summary } = await db.from("fantasy_captain_shadow_summary").select("gameweek").eq("gameweek", REHEARSAL_GW);
  const { data: rehearsalView } = await db.from("fantasy_captain_rehearsal").select("gameweek").eq("gameweek", REHEARSAL_GW);
  check("13. rehearsal rows excluded from evaluation, visible in rehearsal view",
    (summary ?? []).length === 0 && (rehearsalView ?? []).length > 0,
    `evaluation=${(summary ?? []).length} rehearsal=${(rehearsalView ?? []).length}`);

} finally {
  await cleanup(userId);
}

console.log(`\n${results.filter((r) => r.pass).length}/${results.length} checks passed`);
if (failures) { console.error(`${failures} FAILED`); process.exit(1); }
