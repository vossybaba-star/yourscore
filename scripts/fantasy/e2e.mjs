/** Fantasy Phase 1 E2E — full loop against the local dev server (replay GW30).
 *  Run: node --env-file=.env.local scripts/fantasy/e2e.mjs   (from repo root)
 *  Uses the HEALTH_BOT account; resets its fantasy state first (test-only). */
import { signInBot } from "../health/lib/auth.mjs";

const BASE = "http://localhost:3003";
const { userId, cookieHeader } = await signInBot();
console.log("signed in bot:", userId.slice(0, 8));

const call = async (path, body, method) => {
  const res = await fetch(`${BASE}/api/fantasy/${path}`, {
    method: method ?? (body !== undefined ? "POST" : "GET"),
    headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
};
const assert = (cond, msg) => { if (!cond) { console.error("❌ FAIL:", msg); process.exit(1); } console.log("  ✓", msg); };

// 0. clean slate for the bot (direct DB — test-only)
import { createClient } from "@supabase/supabase-js";
const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
await svc.from("fantasy_entries").delete().eq("user_id", userId);
await svc.from("fantasy_squads").delete().eq("user_id", userId);
console.log("bot state reset");

// 1. state → no squad
let r = await call("state");
assert(r.status === 200 && r.json.squad === null, "state: 200, no squad yet");
assert(r.json.gw.gw === 30 && r.json.gw.mode === "replay", "current GW is replay GW30");

// 2. pool + build an invalid squad (14 players) → 400
const pool = (await call("pool")).json.players;
assert(pool.length > 600, `pool served (${pool.length} players)`);
const byPos = (pos) => pool.filter((p) => p.pos === pos).sort((a, b) => a.price - b.price);
const clubCount = {};
const take = (pos, n, expensive = 0) => {
  const src = byPos(pos);
  const picked = [];
  for (const p of (expensive ? src.slice().reverse() : src)) {
    if (picked.length >= n) break;
    if ((clubCount[p.clubId] ?? 0) >= 2) continue; // stay clear of the club cap
    clubCount[p.clubId] = (clubCount[p.clubId] ?? 0) + 1;
    picked.push(p.id);
  }
  return picked;
};
const ids = [...take("GK", 2), ...take("DEF", 5), ...take("MID", 4), ...take("MID", 1, 1), ...take("FWD", 3)];
r = await call("squad", { pickIds: ids.slice(0, 14) });
assert(r.status === 400, "14-man squad rejected (400)");

// 3. valid squad → smart defaults applied
r = await call("squad", { pickIds: ids });
assert(r.status === 200 && r.json.squad?.picks?.length === 15, "15-man squad created");
assert(r.json.squad.xi.length === 11 && r.json.squad.bench.length === 4, "defaults: XI 11 + bench 4");
assert(r.json.squad.captain !== r.json.squad.vice, "captain ≠ vice");
r = await call("squad", { pickIds: ids });
assert(r.status === 409, "second squad rejected (409 exists)");

// 4. round: start, step through 11 (always option[0]; try a replay attack mid-way)
r = await call("round/start", undefined, "POST");
assert(r.status === 200 && r.json.questions.length === 11, "round served (11 questions)");
const questions = r.json.questions;
let correct = 0;
for (let k = 0; k < 11; k++) {
  const opt = questions[k].options[0].id;
  const step = await call("round/step", { k, optionId: opt });
  assert(step.status === 200, `step ${k} accepted`);
  if (step.json.correct) correct++;
  if (k === 3) {
    const replay = await call("round/step", { k: 3, optionId: opt });
    assert(replay.status === 409, "step replay rejected (409 order)");
  }
}
r = await call("state");
const credits = r.json.squad.credits;
console.log(`  round done: ${correct}/11 correct → ${credits} credits (curve B check)`);
const expect = correct >= 11 ? 4 : correct >= 9 ? 3 : correct >= 7 ? 2 : correct >= 5 ? 1 : 0;
assert(credits === expect, `credits match curve B (${credits} for ${correct}/11)`);
assert(r.json.entry.round.done === true, "round marked done");
const dup = await call("round/step", { k: 11, optionId: 1 });
assert(dup.status === 409, "post-completion step rejected");

// 5. transfers: free ones while credits last, then a hit
const state1 = r.json;
const owned = new Set(state1.squad.picks.map((p) => p.id));
const findIn = (out) => pool.find((p) => p.pos === out.pos && !owned.has(p.id) &&
  Math.round(p.price * 10) <= state1.squad.bankTenths + out.buyTenths);
let hits = 0, frees = 0;
for (let i = 0; i < Math.min(credits + 1, 3); i++) {
  const s = (await call("state")).json;
  const out = s.squad.picks.find((p) => {
    const inn = pool.find((q) => q.pos === p.pos && !new Set(s.squad.picks.map((x) => x.id)).has(q.id) &&
      Math.round(q.price * 10) <= s.squad.bankTenths + p.buyTenths);
    return !!inn;
  });
  const inn = pool.find((q) => q.pos === out.pos && !new Set(s.squad.picks.map((x) => x.id)).has(q.id) &&
    Math.round(q.price * 10) <= s.squad.bankTenths + out.buyTenths);
  const t = await call("transfer", { out: out.id, in: inn.id });
  assert(t.status === 200, `transfer ${i + 1} accepted (${t.json.paid})`);
  if (t.json.paid === "hit") hits++; else frees++;
}
console.log(`  transfers: ${frees} free + ${hits} hits`);
if (credits < 3) assert(hits >= 1, "extra transfer charged as a hit");

// 6. price tamper: client-sent prices are ignored by design (no price field accepted)
const bad = await call("transfer", { out: 999999, in: 1 });
assert(bad.status === 400 || bad.status === 409, "bogus transfer rejected");

// 7. lock → score (real GW30 facts via ingest or cached table)
console.log("  locking + scoring (may ingest 10 fixtures — ~30-60s first time)…");
r = await call("lock", undefined, "POST");
assert(r.status === 200 && typeof r.json.points === "number", `locked & scored: ${r.json.points} pts`);
assert(Array.isArray(r.json.breakdown) && r.json.breakdown.length === 11, "11-row breakdown");
const again = await call("lock", undefined, "POST");
assert(again.status === 409, "double lock rejected");

// 8. edits refused after lock
const t2 = await call("transfer", { out: ids[2], in: ids[3] });
assert(t2.status === 409, "transfer after lock rejected");

// 9. state shows result; hits deducted visible
r = await call("state");
assert(r.json.entry.result?.points === (await call("state")).json.entry.result.points, "result stable (idempotent reads)");
console.log(`\n✅ E2E COMPLETE — GW30 result: ${r.json.entry.result.points} pts, hits ${r.json.entry.hits}, captain ${r.json.entry.result.captainUsed}`);
