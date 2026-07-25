/**
 * YourScore Fantasy Football — validation studies on top of the season engine.
 * (Engine logic mirrors season-sim.mjs; this file adds adversarial archetypes,
 * a blank/double fixture calendar with chips, sensitivity sweeps, and an
 * engagement "hope" metric. Same coarse-model caveats: read for DYNAMICS.)
 *
 * Usage: node scripts/fantasy/analysis.mjs <redteam|chaos|sense|hope> [--seasons N] [--out f.json]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const MODE = args[0];
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
/** Points paid per unspent credit (0 = off) — the founder's knowledge→points
 *  symmetry. Measured here so we can see what it does to CHEATING, which is the
 *  thing that changes: a transfer is only worth something if you need one, but
 *  points are worth something always. */
const CONVERT = Number(arg("--convert", "0"));
const RESERVE = Number(arg("--reserve", "1"));
/** Max points one gameweek can earn from cashing credits (0 = uncapped).
 *  The anti-cheat lever. Lookup is worthless today ONLY because the curve has a
 *  flat top: 9, 10 and 11 correct all pay 4 credits, so the last two answers buy
 *  nothing. Cashing credits for points removes that ceiling and lets accuracy pay
 *  without limit — which is what turns cheating from -0.2% into +6%. Capping the
 *  cash at a figure an honest round already reaches puts the flat top back. */
const CAP = Number(arg("--cap", "0"));
const capped = (p) => (CAP > 0 ? Math.min(CAP, p) : p);
/** overflow = cash ONLY what the bank cap would have binned (the LOCKED design);
 *  leftover = cash anything unspent above the reserve (the older, looser variant
 *  the first cheat numbers were measured under). */
const POLICY = arg("--policy", "leftover");
/** 1 = weekly FPL-tracking prices + half-the-rise sell rule (see season-sim.mjs). */
const PRICES = Number(arg("--prices", "0"));
const OUT = arg("--out", "");

function xfnv1a(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rngFor = (s) => mulberry32(xfnv1a(s));

const boot = JSON.parse(readFileSync(join(root, "scripts/data/fpl-bootstrap-cache.json"), "utf8"));
const POS = { 1: "GK", 2: "DEF", 3: "MID", 4: "FWD" };
const players = boot.elements
  .map((e) => ({ id: e.id, name: e.web_name, pos: POS[e.element_type], club: e.team, price: e.now_cost / 10,
    startShare: Math.min(1, (e.starts ?? 0) / 38), ppStart: (e.starts ?? 0) > 0 ? e.total_points / e.starts : 0 }))
  .filter((p) => p.price >= 3.8);
for (const p of players) p.ev = p.ppStart * Math.max(0.3, p.startShare);
const byPos = {};
for (const pos of ["GK", "DEF", "MID", "FWD"]) byPos[pos] = players.filter((p) => p.pos === pos).sort((a, b) => b.ev - a.ev).slice(0, 80);
const MIN_PRICE = { GK: 4.0, DEF: 4.0, MID: 4.5, FWD: 4.5 };
const QUOTA = { GK: 2, DEF: 5, MID: 5, FWD: 3 };
const BUDGET = 100.0, BANK_CAP = 5, HIT = 4;
const GW_MONTH = (gw) => gw <= 3 ? "Aug" : gw <= 6 ? "Sep" : gw <= 10 ? "Oct" : gw <= 13 ? "Nov" : gw <= 19 ? "Dec" : gw <= 23 ? "Jan" : gw <= 27 ? "Feb" : gw <= 30 ? "Mar" : gw <= 34 ? "Apr" : "May";
const MONTHS = ["Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May"];
const MONTH_GWS = { Aug: [1, 3], Sep: [4, 6], Oct: [7, 10], Nov: [11, 13], Dec: [14, 19], Jan: [20, 23], Feb: [24, 27], Mar: [28, 30], Apr: [31, 34], May: [35, 38] };
const CURVE_B = (c) => (c >= 11 ? 4 : c >= 9 ? 3 : c >= 7 ? 2 : c >= 5 ? 1 : 0);

function buildForm(rng, amp = 1) {
  const out = new Map();
  for (const p of players) {
    const f = new Float32Array(39);
    let at = 1, cur = 1 - 0.3 * amp + rng() * 0.6 * amp;
    while (at <= 38) {
      const lo = 1 - 0.4 * amp, span = 0.9 * amp;
      const next = Math.max(0.3, Math.min(2.1, cur * (lo + rng() * span)));
      const len = 4 + Math.floor(rng() * 5);
      for (let g = at; g < Math.min(39, at + len); g++) f[g] = cur + ((next - cur) * (g - at)) / len;
      cur = next; at += len;
    }
    out.set(p.id, f);
  }
  return out;
}

function buildAvailability(rng, afcon = false) {
  const out = new Map();
  for (const p of players) {
    const avail = new Uint8Array(39).fill(1);
    let missTarget = Math.round((1 - p.startShare) * 38 * 0.7);
    let guard = 0;
    while (missTarget > 0 && guard++ < 40) {
      const len = 1 + Math.floor(rng() * Math.min(5, missTarget));
      const at = 1 + Math.floor(rng() * 38);
      for (let g = at; g < Math.min(39, at + len); g++) { if (avail[g]) { avail[g] = 0; missTarget--; } }
    }
    if (afcon && rng() < 0.12) for (let g = 17; g <= 22; g++) avail[g] = 0; // AFCON call-up
    out.set(p.id, avail);
  }
  return out;
}

/** Blank/double calendar: fixtures per club per GW (default 1). */
function buildCalendar(rng) {
  const clubs = [...new Set(players.map((p) => p.club))];
  const cal = Array.from({ length: 39 }, () => new Map());
  const pick = (n) => [...clubs].sort(() => rng() - 0.5).slice(0, n);
  for (const c of pick(8)) cal[29].set(c, 0);               // BGW29
  for (const gw of [32, 36]) for (const c of pick(6)) cal[gw].set(c, 2); // DGWs
  return cal;
}
const fixturesOf = (cal, gw, club) => (cal ? (cal[gw].get(club) ?? 1) : 1);

function buildPriceTrack(prng, form, avail) {
  const out = new Map();
  for (const p of players) {
    const t = new Int16Array(39);
    let cur = Math.round(p.price * 10);
    t[1] = cur;
    const f = form.get(p.id), av = avail.get(p.id);
    const lo = Math.max(38, cur - 20), hi = cur + 25;
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
const priceAt = (track, p, gw) => (track ? track.get(p.id)[gw] : Math.round(p.price * 10));
function sellVal(m, p, gw, track) {
  const cur = priceAt(track, p, gw);
  const buy = m.buy?.get(p.id) ?? Math.round(p.price * 10);
  return cur <= buy ? cur : buy + Math.floor((cur - buy) / 2);
}
function adoptSquad(m, nb, gw, track) {
  m.squad = nb.squad; m.bank = nb.bank;
  m.buy = new Map(nb.squad.map((p) => [p.id, priceAt(track, p, gw)]));
}

function samplePoints(p, gw, form, rng, haulScale = 1) {
  const base = p.ppStart * form.get(p.id)[gw];
  if (rng() < Math.min(0.12, base / 45) * haulScale) return Math.max(2, Math.round(base * 2.2 + 4 + rng() * 8));
  return Math.max(0, Math.round(base * 0.72 + (rng() + rng() - 1) * 3));
}
const evNow = (p, gw, form, cal) => p.ev * form.get(p.id)[gw] * (cal ? Math.max(0.1, fixturesOf(cal, gw, p.club)) : 1);

function buildSquad(rng, jitter = 4, style = "balanced", priceOf = (p) => p.price, budget = BUDGET) {
  const squad = []; let spent = 0; const clubCount = new Map();
  const slots = [];
  for (const pos of ["GK", "DEF", "MID", "FWD"]) for (let i = 0; i < QUOTA[pos]; i++) slots.push(pos);
  for (let i = 0; i < slots.length; i++) {
    const pos = slots[i];
    const minRest = slots.slice(i + 1).reduce((s, ps) => s + MIN_PRICE[ps], 0);
    const maxSpend = budget - spent - minRest;
    let cands = byPos[pos].filter((p) => !squad.includes(p) && priceOf(p) <= maxSpend && (clubCount.get(p.club) ?? 0) < 3);
    if (style === "stars") {
      // 3 galácticos then pure fodder
      const stars = squad.filter((p) => priceOf(p) >= 9.5).length;
      cands = stars < 3 && pos !== "GK"
        ? cands.filter((p) => priceOf(p) >= 9.5).concat(cands).slice(0, cands.length || 1)
        : [...cands].sort((a, b) => priceOf(a) - priceOf(b));
    }
    if (!cands.length) return null;
    const pick = cands[Math.min(cands.length - 1, Math.floor(rng() * jitter))];
    squad.push(pick); spent += priceOf(pick); clubCount.set(pick.club, (clubCount.get(pick.club) ?? 0) + 1);
  }
  return { squad, bank: Math.round((budget - spent) * 10) / 10 };
}

function bestReplacement(m, out, gw, avail, form, cal, track) {
  const owned = new Set(m.squad.map((p) => p.id));
  const clubCount = new Map();
  for (const p of m.squad) if (p !== out) clubCount.set(p.club, (clubCount.get(p.club) ?? 0) + 1);
  // budget = what the sale ACTUALLY raises (half the rise, all the fall) + bank
  const maxSpendT = sellVal(m, out, gw, track) + Math.round(m.bank * 10);
  let best = null, bestEv = -1;
  for (const p of byPos[out.pos]) {
    if (owned.has(p.id) || priceAt(track, p, gw) > maxSpendT || (clubCount.get(p.club) ?? 0) >= 3 || !avail.get(p.id)[gw]) continue;
    const e = evNow(p, gw, form, cal);
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

function pickXI(m, gw, avail, form, cal) {
  const evOf = (p) => (avail.get(p.id)[gw] && fixturesOf(cal, gw, p.club) > 0 ? evNow(p, gw, form, cal) : 0.1);
  const s = [...m.squad].sort((a, b) => evOf(b) - evOf(a));
  const gks = s.filter((p) => p.pos === "GK");
  const defs = s.filter((p) => p.pos === "DEF");
  const fwds = s.filter((p) => p.pos === "FWD");
  const xi = [gks[0], ...defs.slice(0, 3), fwds[0]];
  const rest = s.filter((p) => !xi.includes(p) && p.pos !== "GK");
  xi.push(...rest.slice(0, 6));
  return { xi, bench: s.filter((p) => !xi.includes(p)) };
}

function playWeek(m, gw, ctx, stats) {
  const { avail, form, cal, curve, rng, haulScale, track } = ctx;
  const a = m.a;
  const away = (a.away && gw >= a.away[0] && gw <= a.away[1]) || (a.quitAt && gw >= a.quitAt) || (a.joinAt && gw < a.joinAt);
  const participates = !away && rng() < (a.playProb ?? 1);
  if (gw === 20) { m.wc = 1; m.bonusMinted = 0; }
  // Late join under moving prices: base budget at THIS week's prices.
  if (track && a.joinAt && gw === a.joinAt) {
    const nb = buildSquad(rng, 4, a.squadStyle ?? "balanced", (p) => priceAt(track, p, gw) / 10, BUDGET);
    if (nb) adoptSquad(m, nb, gw, track);
  }
  let hitPts = 0, convPts = 0, chip = null;

  if (participates) {
    m.played++;
    if (m.played % 4 === 0) m.tokens = Math.min(3, m.tokens + 1); // generic chip token every 4 played GWs
    const correct = a.cheat ? 11 : Math.max(0, Math.min(11, Math.round(a.acc + (rng() + rng() + rng() - 1.5) * a.sd)));
    if (correct === 11 && m.bonusMinted < 1) { m.wc = Math.min(2, m.wc + 1); m.bonusMinted++; }
    const minted = curve(correct);
    if (POLICY === "overflow") {
      // LOCKED design: only credits the bank cap would have binned cash out.
      const banked = Math.min(BANK_CAP - m.credits, minted);
      m.credits += banked;
      const spilled = minted - banked;
      if (CONVERT > 0 && spilled > 0) convPts = capped(convPts + spilled * CONVERT);
    } else m.credits = Math.min(BANK_CAP, m.credits + minted);

    const problems = m.squad.filter((p) => !avail.get(p.id)[gw]);
    if (problems.length >= 3 && m.wc > 0) {
      // Wildcard under moving prices: rebuild with TEAM VALUE at today's prices.
      const budget = track
        ? Math.round(m.squad.reduce((t, p) => t + sellVal(m, p, gw, track), 0) + m.bank * 10) / 10
        : BUDGET;
      const nb = buildSquad(rng, 3, a.squadStyle ?? "balanced", (p) => priceAt(track, p, gw) / 10, budget);
      if (nb) { adoptSquad(m, nb, gw, track); m.wc--; }
    } else {
      for (const out of problems) {
        if (m.credits <= 0 && !(a.hits && out.ev > 3)) continue;
        const inn = bestReplacement(m, out, gw, avail, form, cal, track);
        if (!inn) continue;
        if (m.credits > 0) m.credits--; else { hitPts += HIT; m.hitsTaken++; }
        applySwap(m, out, inn, gw, track);
      }
      const thr = a.burnThreshold ?? 0.8;
      while ((a.upgrades ?? false) && m.credits > (a.spendPolicy === "hoard" ? 99 : 0)) {
        const { xi } = pickXI(m, gw, avail, form, cal);
        const worst = [...xi].sort((x, y) => evNow(x, gw, form, cal) - evNow(y, gw, form, cal)).find((p) => p.pos !== "GK");
        const inn = worst && bestReplacement(m, worst, gw, avail, form, cal, track);
        if (!inn || evNow(inn, gw, form, cal) < evNow(worst, gw, form, cal) + thr) break;
        m.credits--; applySwap(m, worst, inn, gw, track);
      }
      // hit-spammer: chases form with -4s once credits are gone
      let spam = 0;
      while (a.hitAggr && m.credits === 0 && spam < (a.maxHitsWk ?? 2)) {
        const { xi } = pickXI(m, gw, avail, form, cal);
        const worst = [...xi].sort((x, y) => evNow(x, gw, form, cal) - evNow(y, gw, form, cal)).find((p) => p.pos !== "GK");
        const inn = worst && bestReplacement(m, worst, gw, avail, form, cal, track);
        if (!inn || evNow(inn, gw, form, cal) < evNow(worst, gw, form, cal) + (a.hitBar ?? 4.5)) break;
        hitPts += HIT; m.hitsTaken++; spam++; applySwap(m, worst, inn, gw, track);
      }
      // Cash what the transfer market didn't want (leftover policy only — the
      // overflow policy already cashed at mint time, above).
      if (CONVERT > 0 && POLICY === "leftover" && m.credits > RESERVE) {
        const cash = m.credits - RESERVE;
        m.credits = RESERVE;
        convPts = capped(convPts + cash * CONVERT);
      }
      // chip play (engaged managers, chaos mode only)
      if (cal && a.chips && m.tokens > 0) {
        const { xi, bench } = pickXI(m, gw, avail, form, cal);
        const cap = [...xi].sort((x, y) => evNow(y, gw, form, cal) - evNow(x, gw, form, cal))[0];
        if (cap && fixturesOf(cal, gw, cap.club) === 2) { chip = "TC"; m.tokens--; }
        else if (bench.filter((b) => avail.get(b.id)[gw] && fixturesOf(cal, gw, b.club) > 0).length >= 3 &&
                 m.squad.filter((p) => fixturesOf(cal, gw, p.club) === 2).length >= 6) { chip = "BB"; m.tokens--; }
      }
    }
  }
  if (gw === 19 && m.wc > 0) { stats.wcExpired = (stats.wcExpired ?? 0) + m.wc; m.wc = 0; }

  const { xi, bench } = pickXI(m, gw, avail, form, cal);
  let pts = 0, deadSlots = 0;
  const scored = new Map(); const active = [];
  const scoreOf = (p) => {
    const fx = fixturesOf(cal, gw, p.club);
    if (fx === 0 || !avail.get(p.id)[gw] || rng() >= 0.92) return null;
    let s = samplePoints(p, gw, form, rng, haulScale ?? 1);
    if (fx === 2) s += samplePoints(p, gw, form, rng, haulScale ?? 1);
    return s;
  };
  for (const p of xi) {
    const s = scoreOf(p);
    if (s !== null) { scored.set(p.id, s); pts += s; active.push(p); }
    else {
      const sub = bench.find((b) => !scored.has(b.id) && (b.pos === "GK") === (p.pos === "GK") && avail.get(b.id)[gw] && fixturesOf(cal, gw, b.club) > 0);
      const ss = sub ? scoreOf(sub) : null;
      if (ss !== null) { scored.set(sub.id, ss); pts += ss; active.push(sub); }
      else deadSlots++;
    }
  }
  if (chip === "BB") for (const b of bench) { if (!scored.has(b.id)) { const s = scoreOf(b); if (s !== null) pts += s; } }
  const sorter = participates ? (x, y) => evNow(y, gw, form, cal) - evNow(x, gw, form, cal) : (x, y) => y.ev - x.ev;
  const cap = active.sort(sorter)[0];
  if (cap) pts += scored.get(cap.id) * (chip === "TC" ? 2 : 1);
  pts -= hitPts;
  pts += convPts; // knowledge cashed as points
  m.season += pts; m.deadSlots += deadSlots;
  const mo = GW_MONTH(gw);
  m.months[mo] = (m.months[mo] ?? 0) + pts;
  if (chip) (m.chipMonths ??= []).push({ mo, chip, gw });
  stats.maxGw = Math.max(stats.maxGw ?? 0, pts);
  return pts;
}

function newManager(key, a, rng) {
  const b = buildSquad(rng, 4, a.squadStyle ?? "balanced") ?? buildSquad(rng, 4);
  return { a: { ...a, key }, squad: b.squad, bank: b.bank,
           buy: new Map(b.squad.map((p) => [p.id, Math.round(p.price * 10)])),
           credits: 0, wc: 1, bonusMinted: 0, tokens: 0,
           season: 0, months: {}, played: 0, hitsTaken: 0, deadSlots: 0 };
}

function runPopulation(popDef, seasons, tag, { cal = false, afcon = false, amp = 1, haulScale = 1, curve = CURVE_B, perGw = null } = {}) {
  const agg = {}; const stats = {};
  for (const k of Object.keys(popDef)) agg[k] = { pts: [], hits: 0, dead: 0, played: 0, monthWins: 0, n: 0 };
  for (let s = 0; s < seasons; s++) {
    const rng = rngFor(`${tag}:${s}`);
    const avail = buildAvailability(rng, afcon);
    const form = buildForm(rng, amp);
    const calendar = cal ? buildCalendar(rng) : null;
    const track = PRICES ? buildPriceTrack(rngFor(`${tag}:${s}:px`), form, avail) : null;
    const managers = [];
    for (const [key, def] of Object.entries(popDef)) for (let i = 0; i < def.n; i++) managers.push(newManager(key, def, rng));
    const ctx = { avail, form, cal: calendar, curve, rng, haulScale, track };
    for (let gw = 1; gw <= 38; gw++) {
      for (const m of managers) playWeek(m, gw, ctx, stats);
      if (perGw) perGw(gw, managers, s, stats);
    }
    for (const mo of MONTHS) {
      const win = managers.filter((m) => m.months[mo]).sort((x, y) => y.months[mo] - x.months[mo])[0];
      if (win) { agg[win.a.key].monthWins++; if (win.chipMonths?.some((c) => c.mo === mo)) stats.chipMonthWins = (stats.chipMonthWins ?? 0) + 1; stats.monthTitles = (stats.monthTitles ?? 0) + 1; }
    }
    for (const m of managers) { const g = agg[m.a.key]; g.pts.push(m.season); g.hits += m.hitsTaken; g.dead += m.deadSlots; g.played += m.played; g.n++;
      (g.tv ??= []).push(Math.round(m.squad.reduce((t, p) => t + sellVal(m, p, 38, track), 0) + m.bank * 10) / 10); }
  }
  const med = (a) => { const x = [...a].sort((p, q) => p - q); return x[Math.floor(x.length / 2)]; };
  const out = {};
  for (const [k, g] of Object.entries(agg)) out[k] = {
    median: med(g.pts), hitsPerSeason: +(g.hits / (g.n / (popDef[k].n))).toFixed(1) / popDef[k].n,
    deadPerWk: +(g.dead / (g.n * 38)).toFixed(2), monthWins: g.monthWins, playedAvg: +(g.played / g.n).toFixed(1),
    teamValue: g.tv ? med(g.tv) : null };
  return { out, stats };
}

const BASE = {
  elite: { n: 20, acc: 9.8, sd: 1.0, playProb: 0.98, hits: true, upgrades: true, chips: true },
  solid: { n: 60, acc: 7.5, sd: 1.5, playProb: 0.92, hits: true, upgrades: true, chips: true },
  casual: { n: 90, acc: 5.5, sd: 1.8, playProb: 0.70, hits: false, upgrades: false },
};

// ═══ STUDIES ═══════════════════════════════════════════════════════════════════
if (MODE === "redteam") {
  const S = Number(arg("--seasons", 30));
  const pop = {
    solid: { n: 40, acc: 7.5, sd: 1.5, playProb: 0.92, hits: true, upgrades: true },        // honest baseline
    cheater: { n: 15, acc: 11, sd: 0, cheat: true, playProb: 0.98, hits: true, upgrades: true }, // looks everything up
    hitspam: { n: 15, acc: 7.5, sd: 1.5, playProb: 0.92, hits: true, upgrades: true, hitAggr: true },
    hoarder: { n: 15, acc: 7.5, sd: 1.5, playProb: 0.92, hits: false, upgrades: true, spendPolicy: "hoard" },
    burner: { n: 15, acc: 7.5, sd: 1.5, playProb: 0.92, hits: true, upgrades: true, burnThreshold: 0.1 },
    skipper: { n: 15, acc: 7.5, sd: 1.5, playProb: 0.5, hits: true, upgrades: true },       // solid brain, half attendance
    stars: { n: 15, acc: 7.5, sd: 1.5, playProb: 0.92, hits: true, upgrades: true, squadStyle: "stars" },
    late8: { n: 15, acc: 7.5, sd: 1.5, playProb: 0.92, hits: true, upgrades: true, joinAt: 8 },
    late15: { n: 15, acc: 7.5, sd: 1.5, playProb: 0.92, hits: true, upgrades: true, joinAt: 15 },
  };
  const { out } = runPopulation(pop, S, "redteam");
  console.log(`═══ RED TEAM (${S} seasons, curve B, vs honest solid) ═══`);
  const base = out.solid.median;
  for (const [k, v] of Object.entries(out))
    console.log(`  ${k.padEnd(8)} median ${v.median} (${v.median >= base ? "+" : ""}${((v.median - base) / base * 100).toFixed(1)}% vs solid) · hits/season ${v.hitsPerSeason} · dead/wk ${v.deadPerWk} · month wins ${v.monthWins}${PRICES ? ` · team value £${v.teamValue}` : ""}`);
  if (OUT) writeFileSync(OUT, JSON.stringify(out, null, 1));
}

if (MODE === "chaos") {
  const S = Number(arg("--seasons", 30));
  const { out, stats } = runPopulation(BASE, S, "chaos", { cal: true, afcon: true });
  const plain = runPopulation(BASE, S, "chaos-plain");
  console.log(`═══ FIXTURE CHAOS (${S} seasons: BGW29 · DGW32+36 · AFCON GW17-22 · TC/BB chips) ═══`);
  for (const k of Object.keys(BASE))
    console.log(`  ${k.padEnd(7)} median ${out[k].median} (plain ${plain.out[k].median}, ${(((out[k].median - plain.out[k].median) / plain.out[k].median) * 100).toFixed(1)}%) · dead/wk ${out[k].deadPerWk} (plain ${plain.out[k].deadPerWk}) · month wins ${out[k].monthWins}`);
  console.log(`  biggest single-GW score: ${stats.maxGw} (plain ${plain.stats.maxGw})`);
  console.log(`  monthly titles won by a chip-play that month: ${stats.chipMonthWins ?? 0}/${stats.monthTitles}`);
  console.log(`  elite vs casual edge: chaos ${(((out.elite.median - out.casual.median) / out.casual.median) * 100).toFixed(1)}% · plain ${(((plain.out.elite.median - plain.out.casual.median) / plain.out.casual.median) * 100).toFixed(1)}%`);
  if (OUT) writeFileSync(OUT, JSON.stringify({ chaos: out, plain: plain.out, stats }, null, 1));
}

if (MODE === "sense") {
  const S = Number(arg("--seasons", 15));
  console.log(`═══ SENSITIVITY (${S} seasons per cell, curve B) — verdict stability ═══`);
  console.log(`  cell = form-drift amp × casual accuracy  →  edge% / casual dead-slots / quitter% of elite`);
  const rows = [];
  for (const amp of [0.6, 1.0, 1.4]) for (const cacc of [4.5, 5.5, 6.5]) {
    const pop = JSON.parse(JSON.stringify(BASE));
    pop.casual.acc = cacc;
    pop.quitter = { n: 10, acc: cacc, sd: 1.8, playProb: 0.70, quitAt: 12 };
    const { out } = runPopulation(pop, S, `sense:${amp}:${cacc}`, { amp });
    const edge = ((out.elite.median - out.casual.median) / out.casual.median * 100).toFixed(1);
    const q = (out.quitter.median / out.elite.median * 100).toFixed(0);
    rows.push({ amp, cacc, edge: +edge, dead: out.casual.deadPerWk, quitterPct: +q });
    console.log(`  amp ${amp} · casual ${cacc}/11  →  +${edge}% / ${out.casual.deadPerWk} / ${q}%`);
  }
  const edges = rows.map((r) => r.edge);
  console.log(`  edge range across all cells: +${Math.min(...edges)}% … +${Math.max(...edges)}%`);
  if (OUT) writeFileSync(OUT, JSON.stringify(rows, null, 1));
}

if (MODE === "hope") {
  const S = Number(arg("--seasons", 20));
  const pop = { ...BASE, lapser: { n: 10, acc: 7.5, sd: 1.5, playProb: 0.95, upgrades: true, away: [10, 16] } };
  const alive = {}; const weeks = {};
  for (const k of Object.keys(pop)) { alive[k] = 0; weeks[k] = 0; }
  // contention is measured inside 10-person FRIEND LEAGUES (the real competitive
  // unit), not the 200-manager global pool — a mixed league per index block.
  const perGw = (gw, managers) => {
    const mo = GW_MONTH(gw);
    const [, moEnd] = MONTH_GWS[mo];
    const left = moEnd - gw + 1; // weeks left incl. current
    for (let base = 0; base + 10 <= managers.length; base += 10) {
      const league = [];
      for (let i = 0; i < 10; i++) league.push(managers[(base + i * 17) % managers.length]); // mixed archetypes
      const lead = Math.max(...league.map((m) => m.months[mo] ?? 0));
      for (const m of league) {
        const gap = lead - (m.months[mo] ?? 0);
        weeks[m.a.key]++;
        if (gap <= 30 * left) alive[m.a.key]++; // "one big week per remaining week" reachable
      }
    }
  };
  runPopulation(pop, S, "hope", { perGw });
  console.log(`═══ HOPE — share of weeks in contention for the month, inside a 10-person friend league (gap ≤ 30 × weeks left) ═══`);
  for (const k of Object.keys(pop)) console.log(`  ${k.padEnd(7)} alive ${(alive[k] / weeks[k] * 100).toFixed(1)}% of all weeks`);
  if (OUT) writeFileSync(OUT, JSON.stringify(Object.fromEntries(Object.keys(pop).map((k) => [k, +(alive[k] / weeks[k] * 100).toFixed(1)])), null, 1));
}

if (!["redteam", "chaos", "sense", "hope"].includes(MODE)) {
  console.log("usage: node scripts/fantasy/analysis.mjs <redteam|chaos|sense|hope> [--seasons N] [--out f.json]");
  process.exit(1);
}
