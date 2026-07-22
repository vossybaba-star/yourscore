#!/usr/bin/env node
/**
 * record-scenario.mjs — turn a REAL Premier League matchday into a replay scenario.
 *
 * The invented scenarios in scenarios/ are useful, but they are still my
 * guesses about when a half-time whistle goes. This one is not a guess: it pulls
 * a matchday that actually happened out of SportMonks' Historical Data and reads
 * the whistle straight off the `periods` include —
 *
 *     period type_id 1 · started 1773500495 · ended 1773503256
 *                                              ↑ THE HALF-TIME WHISTLE
 *
 * — so the resulting scenario has the real kickoff drift (matches start ~90
 * seconds after the scheduled time), the real added time, and the real length of
 * the interval. It prints, per fixture, how far a kickoff+45 timer would have
 * been from the truth. That number is the case for this whole feature.
 *
 *   node --env-file=.env.local scripts/halftime/record-scenario.mjs --date 2026-03-14
 *   node --env-file=.env.local scripts/halftime/record-scenario.mjs --date 2026-03-14 --out recorded-matchday
 *
 * NOT recorded, because SportMonks does not carry it: the moment the confirmed
 * XIs were published. That is synthesised at T-60, and the scenario says so.
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const DATE = opt("date");
const OUT = opt("out", `recorded-${DATE}`);
const LEAD_MIN = Number(opt("lead", "90")); // nominal minutes of runway before the first kickoff

if (!DATE || !/^\d{4}-\d{2}-\d{2}$/.test(DATE)) {
  console.error("usage: record-scenario.mjs --date YYYY-MM-DD [--out <name>] [--lead 90]");
  process.exit(1);
}

const KEY = process.env.SPORTMONKS_API_KEY;
if (!KEY) { console.error("✗ SPORTMONKS_API_KEY not set (use --env-file=.env.local)"); process.exit(1); }

const BASE = process.env.SPORTMONKS_BASE_URL || "https://api.sportmonks.com";

async function sm(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: KEY, Accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} on ${path}`);
  return (await res.json()).data ?? [];
}

// PL = league 8. `periods` is the Historical Data entitlement doing the work.
const fixtures = await sm(
  `/v3/football/fixtures/date/${DATE}?filters=fixtureLeagues:8&include=participants;periods;round`,
);

if (!fixtures.length) {
  console.error(`✗ no Premier League fixtures on ${DATE}`);
  process.exit(1);
}

const named = (f, loc) => f.participants?.find((p) => p.meta?.location === loc)?.name ?? "?";
const period = (f, t) => (f.periods ?? []).find((p) => Number(p.type_id) === t);

const usable = [];
for (const f of fixtures) {
  const p1 = period(f, 1);
  const p2 = period(f, 2);
  if (!p1?.started || !p1?.ended) {
    console.warn(`  skipping ${f.id} ${f.name}: no first-half period data (state ${f.state_id})`);
    continue;
  }
  usable.push({ f, p1, p2 });
}
if (!usable.length) { console.error("✗ no fixture on that date has period data"); process.exit(1); }

// T0 sits LEAD_MIN nominal minutes before the earliest SCHEDULED kickoff, so the
// poller gets its full T-75 pre-match runway inside the scenario.
const firstScheduled = Math.min(...usable.map(({ f }) => f.starting_at_timestamp));
const T0 = firstScheduled - LEAD_MIN * 60;
const min = (ts) => Math.round((ts - T0) / 60);

console.log(`\nPremier League · ${DATE} · ${usable.length} fixture(s) with period data\n`);

const out = { name: OUT, recorded_from: { date: DATE, source: "SportMonks Historical Data (periods include)" }, notes: "", fixtures: [] };
const deltas = [];

for (const { f, p1, p2 } of usable) {
  const scheduledKo = f.starting_at_timestamp;
  const actualKo = p1.started;
  const ht = p1.ended;                       // ← the real half-time whistle
  const secondHalf = p2?.started ?? null;
  const ft = p2?.ended ?? null;

  // What a kickoff+45 timer would have got wrong, measured against reality.
  const timerWouldFire = actualKo + 45 * 60;
  const errSec = ht - timerWouldFire;
  deltas.push({ name: f.name, errSec, htAfterScheduled: (ht - scheduledKo) / 60 });

  const timeline = [
    { at_min: 0, state: "NS" },
    { at_min: min(actualKo), state: "INPLAY_1ST_HALF" },
    { at_min: min(ht), state: "HT" },
  ];
  if (secondHalf) timeline.push({ at_min: min(secondHalf), state: "INPLAY_2ND_HALF" });
  if (ft) timeline.push({ at_min: min(ft), state: "FT" });

  out.fixtures.push({
    id: f.id,
    home: named(f, "home"),
    away: named(f, "away"),
    season_id: f.season_id,
    round: f.round?.name ? `Round ${f.round.name}` : null,
    kickoff_min: min(scheduledKo),
    // SportMonks does not record when the team sheets were published. T-60 is
    // the normal Premier League convention and is SYNTHESISED, not recorded.
    lineups_at_min: min(scheduledKo) - 60,
    recorded: {
      scheduled_kickoff: new Date(scheduledKo * 1000).toISOString(),
      actual_kickoff: new Date(actualKo * 1000).toISOString(),
      halftime_whistle: new Date(ht * 1000).toISOString(),
      first_half_minutes: p1.minutes,
      first_half_added: p1.time_added,
      kickoff_plus_45_error_seconds: errSec,
    },
    timeline,
  });

  const mm = (s) => `${s < 0 ? "-" : "+"}${Math.abs(Math.round(s / 60))}m${String(Math.abs(s) % 60).padStart(2, "0")}s`;
  console.log(
    `  ${String(f.id).padEnd(9)} ${`${named(f, "home")} v ${named(f, "away")}`.padEnd(42)}` +
      ` HT at KO+${((ht - actualKo) / 60).toFixed(1)}'  ·  a kickoff+45 timer would have been ${mm(errSec)} out`,
  );
}

const worst = deltas.reduce((a, b) => (Math.abs(b.errSec) > Math.abs(a.errSec) ? b : a));
out.notes =
  `Recorded from the real Premier League matchday of ${DATE} via SportMonks Historical Data ` +
  `(the periods include: first-half period.ended IS the half-time whistle). Kickoff drift, added time and ` +
  `the length of the interval are all real. On this day a kickoff+45 timer would have been out by up to ` +
  `${Math.round(Math.abs(worst.errSec))}s (${worst.name}). Lineup publication times are NOT in the historical ` +
  `data and are synthesised at T-60.`;

const path = join(HERE, "scenarios", `${OUT}.json`);
writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`);

console.log(
  `\n  worst kickoff+45 error on this matchday: ${Math.round(Math.abs(worst.errSec))}s (${worst.name})`,
);
console.log(`\n✓ → ${path}\n`);
