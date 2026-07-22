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
/** Points paid per unspent transfer credit (0 = the mechanic is off).
 *  The founder's symmetry: a hit turns points into a transfer, so this turns a
 *  transfer back into points — knowledge always pays, you just pick the form.
 *  This flag exists to MEASURE the rate rather than pick it. */
const CONVERT = Number(arg("--convert", "0"));
/** Credits a manager keeps in hand rather than cashing (option value for next week). */
const RESERVE = Number(arg("--reserve", "1"));
/** Max points one gameweek can earn from cashing credits (0 = uncapped).
 *  The anti-cheat lever. Lookup is worthless today ONLY because the curve has a
 *  flat top: 9, 10 and 11 correct all pay 4 credits, so the last two answers buy
 *  nothing. Cashing credits for points removes that ceiling and lets accuracy pay
 *  without limit — which is what turns cheating from -0.2% into +6%. Capping the
 *  cash at a figure an honest round already reaches puts the flat top back. */
const CAP = Number(arg("--cap", "0"));
const capped = (p) => (CAP > 0 ? Math.min(CAP, p) : p);
/** WHICH credits cash out:
 *   leftover — anything unspent above the reserve. Pays whoever has spare credits,
 *              which turns out to be the elite as much as the settled.
 *   overflow — ONLY credits the bank cap would have thrown away. Self-targeting:
 *              you must be AT the cap to earn a point, and you only sit at the cap
 *              if you are not spending. The design already uses this idiom — a
 *              second perfect round overflows into credits (D:153-154). */
const POLICY = arg("--policy", "leftover");
/** 1 = weekly FPL-tracking prices + the half-the-rise sell rule (founder-locked
 *  14 Jul). Off by default so prices-off reproduces the historical baselines
 *  exactly. With prices ON:
 *    - each player's price drifts weekly toward his form (the public, chased
 *      signal — the sim's stand-in for FPL's transfer-momentum price moves),
 *      ±0.1 per week, ~10% of players moving in a given week (FPL's real rate);
 *    - selling pays purchase + HALF the rise (rounded down to 0.1); a fall costs
 *      the whole drop — FPL's parity mechanism, verbatim from engine.ts;
 *    - a wildcard rebuilds at CURRENT prices with your TEAM VALUE (Σ sale + bank),
 *      not a fresh £100m — how FPL's wildcard actually works;
 *    - a late joiner builds at the prices of the week he joins (base £100m). */
const PRICES = Number(arg("--prices", "0"));
/** Max transfer credits per week earnable from HALFTIME quizzes (0 = link off).
 *  Founder-locked 22 Jul: a good halftime score (>=7/10) banks a credit for next
 *  gameweek, same bank + overflow as the round. Engaged managers who watch
 *  football quiz at halftime; modelled as playProb-weighted extra mint. */
const HALFTIME = Number(arg("--halftime", "0"));

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
  // Knows their football, happy with their eleven, never chases form. The
  // player the knowledge→points conversion exists for.
  settled:{ n: 20, acc: 8.5, sd: 1.2, playProb: 0.92, hits: false, upgrades: false },
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

// ── weekly prices + the sell rule (PRICES=1) ─────────────────────────────────
/** id → Int16Array(39): the price (in tenths) managers trade at during each GW.
 *  Movement is driven by LAST week's form — you buy the rise after it starts,
 *  never before, so there is no crystal ball to farm. A flagged-out player gets
 *  sold off (extra fall pressure), which is what FPL's market really does.
 *  Uses its own rng so a prices-on run stays comparable to a prices-off run. */
function buildPriceTrack(prng, form, avail) {
  const out = new Map();
  for (const p of players) {
    const t = new Int16Array(39);
    let cur = Math.round(p.price * 10);
    t[1] = cur;
    const f = form.get(p.id), av = avail.get(p.id);
    const lo = Math.max(38, cur - 20), hi = cur + 25; // a season's realistic drift band
    for (let g = 2; g <= 38; g++) {
      const drive = f[g - 1];
      const up = Math.min(0.3, Math.max(0, (drive - 1.05) * 0.35));
      let dn = Math.min(0.3, Math.max(0, (0.95 - drive) * 0.35));
      if (!av[g - 1]) dn = Math.min(0.45, dn + 0.15);
      const r = prng();
      if (r < up && cur < hi) cur += 1;
      else if (r > 1 - dn && cur > lo) cur -= 1;
      t[g] = cur;
    }
    out.set(p.id, t);
  }
  return out;
}
/** Price in tenths this GW (base price when the price model is off). */
const priceAt = (track, p, gw) => (track ? track.get(p.id)[gw] : Math.round(p.price * 10));
/** What a sale raises, in tenths: engine.ts sellPrice — half the rise, all the fall. */
function sellVal(m, p, gw, track) {
  const cur = priceAt(track, p, gw);
  const buy = m.buy?.get(p.id) ?? Math.round(p.price * 10);
  return cur <= buy ? cur : buy + Math.floor((cur - buy) / 2);
}

function samplePoints(p, gw, form, rng) {
  const base = p.ppStart * form.get(p.id)[gw];
  if (rng() < Math.min(0.12, base / 45)) return Math.max(2, Math.round(base * 2.2 + 4 + rng() * 8)); // haul
  return Math.max(0, Math.round(base * 0.72 + (rng() + rng() - 1) * 3));
}
/** what managers can see: current expected value including form */
const evNow = (p, gw, form) => p.ev * form.get(p.id)[gw];

// ── squad ops ─────────────────────────────────────────────────────────────────
function buildSquad(rng, jitter = 4, priceOf = (p) => p.price, budget = BUDGET) {
  // greedy with seeded jitter so squads differ; respects quotas, budget, max 3/club
  const squad = []; let spent = 0; const clubCount = new Map();
  const slots = [];
  for (const pos of ["GK", "DEF", "MID", "FWD"]) for (let i = 0; i < QUOTA[pos]; i++) slots.push(pos);
  // fill expensive slots first, cheapest last (bench fodder)
  for (let i = 0; i < slots.length; i++) {
    const pos = slots[i];
    const minRest = slots.slice(i + 1).reduce((s, ps) => s + MIN_PRICE[ps], 0);
    const maxSpend = budget - spent - minRest;
    const cands = byPos[pos].filter((p) => !squad.includes(p) && priceOf(p) <= maxSpend && (clubCount.get(p.club) ?? 0) < 3);
    if (!cands.length) return null;
    const pick = cands[Math.min(cands.length - 1, Math.floor(rng() * jitter))];
    squad.push(pick); spent += priceOf(pick); clubCount.set(pick.club, (clubCount.get(pick.club) ?? 0) + 1);
  }
  return { squad, bank: Math.round((budget - spent) * 10) / 10 };
}

/** Rebuild helper: swap a manager onto a fresh squad, re-basing his buy prices
 *  at what the new players cost TODAY (wildcard / late join). */
function adoptSquad(m, nb, gw, track) {
  m.squad = nb.squad; m.bank = nb.bank;
  m.buy = new Map(nb.squad.map((p) => [p.id, priceAt(track, p, gw)]));
}

function bestReplacement(m, out, gw, avail, form, track) {
  const owned = new Set(m.squad.map((p) => p.id));
  const clubCount = new Map();
  for (const p of m.squad) if (p !== out) clubCount.set(p.club, (clubCount.get(p.club) ?? 0) + 1);
  // budget = what the sale ACTUALLY raises (half the rise, all the fall) + bank
  const maxSpendT = sellVal(m, out, gw, track) + Math.round(m.bank * 10);
  let best = null, bestEv = -1;
  for (const p of byPos[out.pos]) {
    if (owned.has(p.id) || priceAt(track, p, gw) > maxSpendT || (clubCount.get(p.club) ?? 0) >= 3 || !avail.get(p.id)[gw]) continue;
    const e = evNow(p, gw, form);
    if (e > bestEv) { bestEv = e; best = p; }
  }
  return best;
}

function applySwap(m, out, inn, gw, track) {
  m.squad[m.squad.indexOf(out)] = inn;
  const paid = priceAt(track, inn, gw);
  m.bank = Math.round(m.bank * 10 + sellVal(m, out, gw, track) - paid) / 10;
  if (m.buy) { m.buy.delete(out.id); m.buy.set(inn.id, paid); }
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
function playWeek(m, gw, avail, form, curve, rng, stats, track) {
  const a = m.a;
  const away = (a.away && gw >= a.away[0] && gw <= a.away[1]) || (a.quitAt && gw >= a.quitAt) || (a.joinAt && gw < a.joinAt);
  const participates = !away && rng() < a.playProb;
  if (gw === 20) { m.wc = 1; m.bonusMinted = 0; } // second-half wildcard issued
  // Late join under moving prices: you build at the prices of the week you join,
  // from the base budget — the market has moved on without you (the real rule).
  if (track && a.joinAt && gw === a.joinAt) {
    const nb = buildSquad(rng, 4, (p) => priceAt(track, p, gw) / 10, BUDGET);
    if (nb) adoptSquad(m, nb, gw, track);
  }
  let hitPts = 0, convPts = 0;

  if (participates) {
    m.played++;
    const correct = Math.max(0, Math.min(11, Math.round(a.acc + (rng() + rng() + rng() - 1.5) * a.sd)));
    if (correct === 11 && m.bonusMinted < 1) { m.wc = Math.min(2, m.wc + 1); m.bonusMinted++; stats.bonusWc++; }
    let minted = curve(correct);
    // Halftime link: an engaged manager watching the weekend's football clears
    // the 7/10 bar on ~60% of played weeks; a big Saturday sometimes yields two.
    if (HALFTIME > 0 && rng() < 0.6) minted += Math.min(HALFTIME, 1 + (rng() < 0.35 ? 1 : 0));
    if (POLICY === "overflow") {
      const banked = Math.min(BANK_CAP - m.credits, minted);
      m.credits += banked;
      const spilled = minted - banked; // the cap used to silently bin these
      if (CONVERT > 0 && spilled > 0) { convPts = capped(convPts + spilled * CONVERT); stats.converted += spilled; }
    } else {
      m.credits = Math.min(BANK_CAP, m.credits + curve(correct));
    }
    m.accSum += correct;

    // problems = squad players flagged out this GW
    const problems = m.squad.filter((p) => !avail.get(p.id)[gw]);
    if (problems.length >= 3 && m.wc > 0) {
      // WILDCARD: full rebuild. Under moving prices the budget is your TEAM VALUE
      // (Σ what selling everyone raises + bank) at today's prices — not a fresh
      // £100m. This is how team-value growth compounds through a wildcard in FPL.
      const budget = track
        ? Math.round(m.squad.reduce((s, p) => s + sellVal(m, p, gw, track), 0) + m.bank * 10) / 10
        : BUDGET;
      const nb = buildSquad(rng, 3, (p) => priceAt(track, p, gw) / 10, budget);
      if (nb) { adoptSquad(m, nb, gw, track); m.wc--; stats.wcPlayed[GW_MONTH(gw)] = (stats.wcPlayed[GW_MONTH(gw)] ?? 0) + 1; }
    } else {
      // transfers: fix flagged first, then chase form with remaining credits
      for (const out of problems) {
        if (m.credits <= 0 && !(a.hits && out.ev > 3)) continue;
        const inn = bestReplacement(m, out, gw, avail, form, track);
        if (!inn) continue;
        if (m.credits > 0) m.credits--; else { hitPts += HIT; stats.hits++; }
        applySwap(m, out, inn, gw, track); stats.transfers++;
      }
      while (a.upgrades && m.credits > 0) {
        const { xi } = pickXI(m, gw, avail, form);
        const worst = [...xi].sort((x, y) => evNow(x, gw, form) - evNow(y, gw, form)).find((p) => p.pos !== "GK");
        const inn = worst && bestReplacement(m, worst, gw, avail, form, track);
        if (!inn || evNow(inn, gw, form) < evNow(worst, gw, form) + 0.8) break;
        m.credits--; applySwap(m, worst, inn, gw, track); stats.transfers++;
      }
    }
    // Cash whatever the transfer market didn't want. A manager only reaches here
    // holding credits because no swap cleared the EV bar — i.e. they're settled.
    // That's exactly the player this mechanic is for: their knowledge pays in
    // points instead of forcing churn they don't want.
    if (CONVERT > 0 && POLICY === "leftover" && m.credits > RESERVE) {
      const cash = m.credits - RESERVE;
      m.credits = RESERVE;
      convPts = capped(convPts + cash * CONVERT);
      stats.converted += cash;
      stats.convertedBy[m.a.key] = (stats.convertedBy[m.a.key] ?? 0) + cash;
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
  pts += convPts; // knowledge cashed as points — the other side of the hit
  m.season += pts;
  m.months[GW_MONTH(gw)] = (m.months[GW_MONTH(gw)] ?? 0) + pts;
  stats.gwCum[m.a.key][gw] += m.season;
  if (m.a.key === "casual") { stats.casualDeadSlots += deadSlots; stats.casualWeeks++; }
  if (m.trace) m.trace.push({ gw, pts, credits: m.credits, away, season: m.season });
}

// ── run ───────────────────────────────────────────────────────────────────────
const results = {};
for (const [curveName, curve] of Object.entries(CURVES)) {
  const agg = { seasonPts: {}, monthWins: {}, hits: 0, transfers: 0, converted: 0, convertedBy: {}, wcPlayed: {}, wcExpired: 0, bonusWc: 0, casualDeadSlots: 0, casualWeeks: 0, credits: {}, played: {}, teamValue: {}, gwCum: {}, gwCumN: {}, monthAvg: {}, monthAvgN: {} };
  for (const k of Object.keys(ARCHETYPES)) { agg.seasonPts[k] = []; agg.credits[k] = []; agg.played[k] = []; agg.teamValue[k] = []; agg.gwCum[k] = new Float64Array(39); agg.gwCumN[k] = 0; agg.monthAvg[k] = {}; agg.monthAvgN[k] = 0; }
  let lapserTrace = null;

  for (let s = 0; s < SEASONS; s++) {
    const rng = rngFor(`${curveName}:${s}`);
    const avail = buildAvailability(rng);
    const form = buildForm(rng);
    // The price track burns its own rng so prices-on vs prices-off seasons stay
    // draw-for-draw comparable everywhere else.
    const track = PRICES ? buildPriceTrack(rngFor(`${curveName}:${s}:px`), form, avail) : null;
    const managers = [];
    for (const [key, a] of Object.entries(ARCHETYPES))
      for (let i = 0; i < a.n; i++) {
        const b = buildSquad(rng);
        managers.push({ a: { ...a, key }, squad: b.squad, bank: b.bank,
          buy: new Map(b.squad.map((p) => [p.id, Math.round(p.price * 10)])),
          credits: 0, wc: 1, bonusMinted: 0, season: 0, months: {}, played: 0, accSum: 0, trace: key === "lapser" && i === 0 && s === 0 ? [] : null });
      }
    for (let gw = 1; gw <= 38; gw++) for (const m of managers) playWeek(m, gw, avail, form, curve, rng, agg, track);
    for (const m of managers) {
      agg.seasonPts[m.a.key].push(m.season); agg.credits[m.a.key].push(m.credits); agg.played[m.a.key].push(m.played);
      // end-of-season team value: what selling up would raise + bank (£)
      agg.teamValue[m.a.key].push(Math.round(m.squad.reduce((t, p) => t + sellVal(m, p, 38, track), 0) + m.bank * 10) / 10);
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
  if (PRICES) {
    const tv = Object.fromEntries(Object.keys(ARCHETYPES).map((k) => [k, med(agg.teamValue[k])]));
    summary.teamValue = tv;
    console.log(`  end-of-season team value (£, started 100):`, Object.entries(tv).map(([k, v]) => `${k} ${v}`).join(" · "));
  }
  const mw = {}; for (const mo of MONTHS) for (const [k, n] of Object.entries(agg.monthWins[mo] ?? {})) mw[k] = (mw[k] ?? 0) + n;
  console.log(`  month wins by archetype:`, mw);
}

if (OUT) { writeFileSync(OUT, JSON.stringify(results, null, 1)); console.log(`\nwrote ${OUT}`); }
