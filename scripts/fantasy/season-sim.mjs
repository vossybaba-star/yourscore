/**
 * YourScore Fantasy Football — full-game season simulator (design-validation tool).
 *
 * Simulates 38-GW seasons under the locked design (docs/your-pl-xi-design.md):
 * 15-man squad (2/5/5/3, £100m, max 3/club) · weekly knowledge round earns transfer
 * credits (bank cap 5) · extra moves cost -4 pts · wildcard 1 issued/half (+1 bonus
 * per half minted by a perfect round) · captain→vice→best-form defaults · auto-subs ·
 * monthly tables headline, season behind · round encouraged not forced (skip = earn 0).
 *
 * Population of manager ARCHETYPES (elite/solid/casual/lapser/quitter/late-joiner)
 * plays whole seasons against real player data (FPL 25/26 bootstrap cache: prices,
 * per-start scoring rates, availability). Player scoring is a coarse stochastic model
 * (per-start rate + haul tail) — good for DYNAMICS (economies, decay, comebacks),
 * not for predicting real point totals.
 *
 * Usage: node scripts/fantasy/season-sim.mjs [--seasons 60] [--out results.json]
 * Deterministic per seed. No network (reads scripts/data/fpl-bootstrap-cache.json).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SEASONS = Number(arg("--seasons", 60));
const OUT = arg("--out", "");

// ── rng (repo pattern) ────────────────────────────────────────────────────────
function xfnv1a(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rngFor = (s) => mulberry32(xfnv1a(s));

// ── player pool from real data ────────────────────────────────────────────────
const boot = JSON.parse(readFileSync(join(root, "scripts/data/fpl-bootstrap-cache.json"), "utf8"));
const POS = { 1: "GK", 2: "DEF", 3: "MID", 4: "FWD" };
const players = boot.elements
  .map((e) => ({
    id: e.id, name: e.web_name, pos: POS[e.element_type], club: e.team,
    price: e.now_cost / 10,
    startShare: Math.min(1, (e.starts ?? 0) / 38),
    ppStart: (e.starts ?? 0) > 0 ? e.total_points / e.starts : 0,
  }))
  .filter((p) => p.price >= 3.8);
// expected weekly value used by managers to pick teams/transfers
for (const p of players) p.ev = p.ppStart * Math.max(0.3, p.startShare);
const byPos = {};
for (const pos of ["GK", "DEF", "MID", "FWD"]) byPos[pos] = players.filter((p) => p.pos === pos).sort((a, b) => b.ev - a.ev).slice(0, 80);
const MIN_PRICE = { GK: 4.0, DEF: 4.0, MID: 4.5, FWD: 4.5 };

// ── season structure ──────────────────────────────────────────────────────────
const QUOTA = { GK: 2, DEF: 5, MID: 5, FWD: 3 };
const BUDGET = 100.0;
const BANK_CAP = 5;
const HIT = 4;
const GW_MONTH = (gw) => gw <= 3 ? "Aug" : gw <= 6 ? "Sep" : gw <= 10 ? "Oct" : gw <= 13 ? "Nov" : gw <= 19 ? "Dec" : gw <= 23 ? "Jan" : gw <= 27 ? "Feb" : gw <= 30 ? "Mar" : gw <= 34 ? "Apr" : "May";
const MONTHS = ["Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May"];

// credit curves to sweep: f(correct of 11) → free transfers earned
const CURVES = {
  // LOCKED default (founder 11 Jul, kinder floor after playtest): 3→1,5→2,7→3,9→4.
  E_locked: (c) => (c >= 9 ? 4 : c >= 7 ? 3 : c >= 5 ? 2 : c >= 3 ? 1 : 0),
  B_moderate: (c) => (c >= 11 ? 4 : c >= 9 ? 3 : c >= 7 ? 2 : c >= 5 ? 1 : 0),
  A_stingy: (c) => (c >= 11 ? 3 : c >= 9 ? 2 : c >= 7 ? 1 : 0),
};

// archetypes: acc = mean correct of 11, playProb = weekly participation
const ARCHETYPES = {
  elite:  { n: 20, acc: 9.8, sd: 1.0, playProb: 0.98, hits: true,  upgrades: true },
  solid:  { n: 60, acc: 7.5, sd: 1.5, playProb: 0.92, hits: true,  upgrades: true },
  casual: { n: 90, acc: 5.5, sd: 1.8, playProb: 0.70, hits: false, upgrades: false },
  lapser: { n: 10, acc: 7.5, sd: 1.5, playProb: 0.95, hits: false, upgrades: true, away: [10, 16] },
  quitter:{ n: 10, acc: 5.5, sd: 1.8, playProb: 0.70, hits: false, upgrades: false, quitAt: 12 },
  late:   { n: 10, acc: 7.5, sd: 1.5, playProb: 0.92, hits: true,  upgrades: true, joinAt: 8 },
};

// ── per-season form drift (public, chaseable — the reason transfers have value)
// each player's effective value wanders over the season: piecewise targets every
// ~6 GWs, linearly interpolated. Managers see current form; scoring uses it.
function buildForm(rng) {
  const out = new Map(); // id → Float32Array(39) multiplier around 1
  for (const p of players) {
    const f = new Float32Array(39);
    let at = 1, cur = 0.7 + rng() * 0.6;
    while (at <= 38) {
      const next = Math.max(0.35, Math.min(2.0, cur * (0.6 + rng() * 0.9)));
      const len = 4 + Math.floor(rng() * 5);
      for (let g = at; g < Math.min(39, at + len); g++) f[g] = cur + ((next - cur) * (g - at)) / len;
      cur = next; at += len;
    }
    out.set(p.id, f);
  }
  return out;
}

// ── per-season player availability (absence spells, visible flags) ───────────
function buildAvailability(rng) {
  const out = new Map(); // id → Uint8Array(39) 1=available
  for (const p of players) {
    const avail = new Uint8Array(39).fill(1);
    let missTarget = Math.round((1 - p.startShare) * 38 * 0.7); // 70% of non-starts = visible absences; rest = random DNP
    let guard = 0;
    while (missTarget > 0 && guard++ < 40) {
      const len = 1 + Math.floor(rng() * Math.min(5, missTarget));
      const at = 1 + Math.floor(rng() * 38);
      for (let g = at; g < Math.min(39, at + len); g++) { if (avail[g]) { avail[g] = 0; missTarget--; } }
    }
    out.set(p.id, avail);
  }
  return out;
}

function samplePoints(p, gw, form, rng) {
  const base = p.ppStart * form.get(p.id)[gw];
  if (rng() < Math.min(0.12, base / 45)) return Math.max(2, Math.round(base * 2.2 + 4 + rng() * 8)); // haul
  return Math.max(0, Math.round(base * 0.72 + (rng() + rng() - 1) * 3));
}
/** what managers can see: current expected value including form */
const evNow = (p, gw, form) => p.ev * form.get(p.id)[gw];

// ── squad ops ─────────────────────────────────────────────────────────────────
function buildSquad(rng, jitter = 4) {
  // greedy with seeded jitter so squads differ; respects quotas, budget, max 3/club
  const squad = []; let spent = 0; const clubCount = new Map();
  const slots = [];
  for (const pos of ["GK", "DEF", "MID", "FWD"]) for (let i = 0; i < QUOTA[pos]; i++) slots.push(pos);
  // fill expensive slots first, cheapest last (bench fodder)
  for (let i = 0; i < slots.length; i++) {
    const pos = slots[i];
    const slotsLeft = slots.length - i - 1;
    const minRest = slots.slice(i + 1).reduce((s, ps) => s + MIN_PRICE[ps], 0);
    const maxSpend = BUDGET - spent - minRest;
    const cands = byPos[pos].filter((p) => !squad.includes(p) && p.price <= maxSpend && (clubCount.get(p.club) ?? 0) < 3);
    if (!cands.length) return null;
    const pick = cands[Math.min(cands.length - 1, Math.floor(rng() * jitter))];
    squad.push(pick); spent += pick.price; clubCount.set(pick.club, (clubCount.get(pick.club) ?? 0) + 1);
  }
  return { squad, bank: Math.round((BUDGET - spent) * 10) / 10 };
}

function bestReplacement(m, out, gw, avail, form) {
  const owned = new Set(m.squad.map((p) => p.id));
  const clubCount = new Map();
  for (const p of m.squad) if (p !== out) clubCount.set(p.club, (clubCount.get(p.club) ?? 0) + 1);
  const maxSpend = out.price + m.bank;
  let best = null, bestEv = -1;
  for (const p of byPos[out.pos]) {
    if (owned.has(p.id) || p.price > maxSpend || (clubCount.get(p.club) ?? 0) >= 3 || !avail.get(p.id)[gw]) continue;
    const e = evNow(p, gw, form);
    if (e > bestEv) { bestEv = e; best = p; }
  }
  return best;
}

function applySwap(m, out, inn) {
  m.squad[m.squad.indexOf(out)] = inn;
  m.bank = Math.round((m.bank + out.price - inn.price) * 10) / 10;
}

function pickXI(m, gw, avail, form) {
  const evOf = (p) => (avail.get(p.id)[gw] ? evNow(p, gw, form) : 0.1); // flagged → benched
  const s = [...m.squad].sort((a, b) => evOf(b) - evOf(a));
  const gks = s.filter((p) => p.pos === "GK");
  const defs = s.filter((p) => p.pos === "DEF");
  const fwds = s.filter((p) => p.pos === "FWD");
  const xi = [gks[0], ...defs.slice(0, 3), fwds[0]];
  const rest = s.filter((p) => !xi.includes(p) && p.pos !== "GK");
  xi.push(...rest.slice(0, 6));
  const bench = s.filter((p) => !xi.includes(p));
  return { xi, bench };
}

// ── one manager, one gameweek ─────────────────────────────────────────────────
function playWeek(m, gw, avail, form, curve, rng, stats) {
  const a = m.a;
  const away = (a.away && gw >= a.away[0] && gw <= a.away[1]) || (a.quitAt && gw >= a.quitAt) || (a.joinAt && gw < a.joinAt);
  const participates = !away && rng() < a.playProb;
  const half = gw <= 19 ? 0 : 1;
  if (gw === 20) { m.wc = 1; m.bonusMinted = 0; } // second-half wildcard issued
  let hitPts = 0;

  if (participates) {
    m.played++;
    const correct = Math.max(0, Math.min(11, Math.round(a.acc + (rng() + rng() + rng() - 1.5) * a.sd)));
    if (correct === 11 && m.bonusMinted < 1) { m.wc = Math.min(2, m.wc + 1); m.bonusMinted++; stats.bonusWc++; }
    m.credits = Math.min(BANK_CAP, m.credits + curve(correct));
    m.accSum += correct;

    // problems = squad players flagged out this GW
    const problems = m.squad.filter((p) => !avail.get(p.id)[gw]);
    if (problems.length >= 3 && m.wc > 0) {
      // WILDCARD: full rebuild
      const nb = buildSquad(rng, 3);
      if (nb) { m.squad = nb.squad; m.bank = nb.bank; m.wc--; stats.wcPlayed[GW_MONTH(gw)] = (stats.wcPlayed[GW_MONTH(gw)] ?? 0) + 1; }
    } else {
      // transfers: fix flagged first, then chase form with remaining credits
      for (const out of problems) {
        if (m.credits <= 0 && !(a.hits && out.ev > 3)) continue;
        const inn = bestReplacement(m, out, gw, avail, form);
        if (!inn) continue;
        if (m.credits > 0) m.credits--; else { hitPts += HIT; stats.hits++; }
        applySwap(m, out, inn); stats.transfers++;
      }
      while (a.upgrades && m.credits > 0) {
        const { xi } = pickXI(m, gw, avail, form);
        const worst = [...xi].sort((x, y) => evNow(x, gw, form) - evNow(y, gw, form)).find((p) => p.pos !== "GK");
        const inn = worst && bestReplacement(m, worst, gw, avail, form);
        if (!inn || evNow(inn, gw, form) < evNow(worst, gw, form) + 0.8) break;
        m.credits--; applySwap(m, worst, inn); stats.transfers++;
      }
    }
  }
  // wildcard expiry at GW19 deadline
  if (gw === 19 && m.wc > 0) { stats.wcExpired += m.wc; m.wc = 0; }

  // score the week (auto-pilot works even when away — squad rolls over)
  const { xi, bench } = pickXI(m, gw, avail, form);
  let pts = 0, deadSlots = 0;
  const scored = new Map();
  const playedFlag = (p) => avail.get(p.id)[gw] && rng() < 0.92; // 8% surprise DNP
  const active = [];
  for (const p of xi) {
    if (playedFlag(p)) { const s = samplePoints(p, gw, form, rng); scored.set(p.id, s); pts += s; active.push(p); }
    else {
      // auto-sub: first bench player of legal position who played
      const sub = bench.find((b) => playedFlag(b) && (b.pos === "GK") === (p.pos === "GK") && !scored.has(b.id));
      if (sub) { const s = samplePoints(sub, gw, form, rng); scored.set(sub.id, s); pts += s; active.push(sub); }
      else deadSlots++;
    }
  }
  // captain ×2: engaged managers captain by current form; a coasting week = the
  // carry-over default (base ev) — the smart-default chain, slightly less sharp
  const sorter = participates ? (x, y) => evNow(y, gw, form) - evNow(x, gw, form) : (x, y) => y.ev - x.ev;
  const cap = active.sort(sorter)[0];
  if (cap) pts += scored.get(cap.id);
  pts -= hitPts;
  m.season += pts;
  m.months[GW_MONTH(gw)] = (m.months[GW_MONTH(gw)] ?? 0) + pts;
  stats.gwCum[m.a.key][gw] += m.season;
  if (m.a.key === "casual") { stats.casualDeadSlots += deadSlots; stats.casualWeeks++; }
  if (m.trace) m.trace.push({ gw, pts, credits: m.credits, away, season: m.season });
}

// ── run ───────────────────────────────────────────────────────────────────────
const results = {};
for (const [curveName, curve] of Object.entries(CURVES)) {
  const agg = { seasonPts: {}, monthWins: {}, hits: 0, transfers: 0, wcPlayed: {}, wcExpired: 0, bonusWc: 0, casualDeadSlots: 0, casualWeeks: 0, credits: {}, played: {}, gwCum: {}, gwCumN: {}, monthAvg: {}, monthAvgN: {} };
  for (const k of Object.keys(ARCHETYPES)) { agg.seasonPts[k] = []; agg.credits[k] = []; agg.played[k] = []; agg.gwCum[k] = new Float64Array(39); agg.gwCumN[k] = 0; agg.monthAvg[k] = {}; agg.monthAvgN[k] = 0; }
  let lapserTrace = null;

  for (let s = 0; s < SEASONS; s++) {
    const rng = rngFor(`${curveName}:${s}`);
    const avail = buildAvailability(rng);
    const form = buildForm(rng);
    const managers = [];
    for (const [key, a] of Object.entries(ARCHETYPES))
      for (let i = 0; i < a.n; i++) {
        const b = buildSquad(rng);
        managers.push({ a: { ...a, key }, squad: b.squad, bank: b.bank, credits: 0, wc: 1, bonusMinted: 0, season: 0, months: {}, played: 0, accSum: 0, trace: key === "lapser" && i === 0 && s === 0 ? [] : null });
      }
    for (let gw = 1; gw <= 38; gw++) for (const m of managers) playWeek(m, gw, avail, form, curve, rng, agg);
    for (const m of managers) {
      agg.seasonPts[m.a.key].push(m.season); agg.credits[m.a.key].push(m.credits); agg.played[m.a.key].push(m.played);
      agg.gwCumN[m.a.key]++; agg.monthAvgN[m.a.key]++;
      for (const mo of MONTHS) agg.monthAvg[m.a.key][mo] = (agg.monthAvg[m.a.key][mo] ?? 0) + (m.months[mo] ?? 0);
      if (m.trace) lapserTrace = m.trace;
    }
    for (const mo of MONTHS) {
      const win = managers.filter((m) => m.months[mo]).sort((x, y) => y.months[mo] - x.months[mo])[0];
      if (win) { agg.monthWins[mo] = agg.monthWins[mo] ?? {}; agg.monthWins[mo][win.a.key] = (agg.monthWins[mo][win.a.key] ?? 0) + 1; }
    }
  }

  const med = (a) => { const x = [...a].sort((p, q) => p - q); return x[Math.floor(x.length / 2)]; };
  const summary = { archetypes: {}, monthWins: agg.monthWins, wcPlayed: agg.wcPlayed, perSeason: {
    hits: +(agg.hits / SEASONS).toFixed(1), transfers: +(agg.transfers / SEASONS).toFixed(1),
    wcExpired: +(agg.wcExpired / SEASONS).toFixed(2), bonusWc: +(agg.bonusWc / SEASONS).toFixed(2) } };
  for (const k of Object.keys(ARCHETYPES)) summary.archetypes[k] = { median: med(agg.seasonPts[k]), p25: [...agg.seasonPts[k]].sort((a, b) => a - b)[Math.floor(agg.seasonPts[k].length * 0.25)], p75: [...agg.seasonPts[k]].sort((a, b) => a - b)[Math.floor(agg.seasonPts[k].length * 0.75)] };
  summary.edgeEliteVsCasual = +(((summary.archetypes.elite.median - summary.archetypes.casual.median) / summary.archetypes.casual.median) * 100).toFixed(1);
  summary.edgeEliteVsSolid = +(((summary.archetypes.elite.median - summary.archetypes.solid.median) / summary.archetypes.solid.median) * 100).toFixed(1);
  summary.casualDeadSlotsPerWeek = +(agg.casualDeadSlots / Math.max(1, agg.casualWeeks)).toFixed(2);
  summary.lapserTrace = lapserTrace;
  summary.gwCum = {}; summary.monthAvg = {};
  for (const k of Object.keys(ARCHETYPES)) {
    summary.gwCum[k] = Array.from(agg.gwCum[k].slice(1), (v) => Math.round(v / Math.max(1, agg.gwCumN[k])));
    summary.monthAvg[k] = Object.fromEntries(MONTHS.map((mo) => [mo, Math.round((agg.monthAvg[k][mo] ?? 0) / Math.max(1, agg.monthAvgN[k]))]));
  }
  results[curveName] = summary;

  console.log(`\n═══ curve ${curveName} (${SEASONS} seasons × 200 managers) ═══`);
  for (const [k, v] of Object.entries(summary.archetypes)) console.log(`  ${k.padEnd(8)} median ${v.median} (p25 ${v.p25} · p75 ${v.p75})`);
  console.log(`  edge: elite vs casual +${summary.edgeEliteVsCasual}% · elite vs solid +${summary.edgeEliteVsSolid}%`);
  console.log(`  per season: ${summary.perSeason.transfers} transfers · ${summary.perSeason.hits} hits · wc expired ${summary.perSeason.wcExpired} · bonus wc ${summary.perSeason.bonusWc}`);
  console.log(`  casual dead XI slots/week: ${summary.casualDeadSlotsPerWeek}`);
  const mw = {}; for (const mo of MONTHS) for (const [k, n] of Object.entries(agg.monthWins[mo] ?? {})) mw[k] = (mw[k] ?? 0) + n;
  console.log(`  month wins by archetype:`, mw);
}

if (OUT) { writeFileSync(OUT, JSON.stringify(results, null, 1)); console.log(`\nwrote ${OUT}`); }
