#!/usr/bin/env node
/**
 * sync-fixtures.mjs — the season's spine. Upserts every Premier League fixture in
 * a rolling window into halftime_releases.
 *
 * DATE-DRIVEN, NOT GAMEWEEK-DRIVEN. A fixture is work because it exists in the
 * window, not because of the label on it. That one decision is what makes the
 * whole season fall out for free:
 *   · midweek rounds        — just fixtures on a Tuesday
 *   · double gameweeks      — just two fixtures for a club in one window
 *   · rearranged fixtures   — reappear on their new date and re-enter the pipeline
 *   · blank gameweeks       — zero rows; every downstream job no-ops at zero cost
 *   · postponements         — the row stops appearing on the old date; the
 *                             matchday re-sync catches it before any content work
 *
 * Idempotent by construction: upsert on the unique fixture_id. Running it twice
 * changes nothing (AC29). Kick-off changes overwrite kickoff_at, which is exactly
 * what the veto-deadline recomputation depends on.
 *
 * The upsert is ASSERTED, not assumed (LOOP rule 1): we re-read the window and
 * compare counts. A silent filter/entitlement break — the failure that would
 * quietly give us an empty Saturday — shows up here as a warning, not as silence.
 *
 * CLI (spec §5):
 *   sync-fixtures.mjs                 next 14 days (the weekly Monday job)
 *   sync-fixtures.mjs --window 21
 *   sync-fixtures.mjs --date 2026-08-22   just that day (the matchday 07:00 re-sync)
 *   sync-fixtures.mjs --dry-run
 */

import * as sm from "./lib/sm.mjs";
import * as api from "./lib/api.mjs";
import { loadEnvFile, flag, has } from "./lib/env.mjs";

const ymd = (d) => d.toISOString().slice(0, 10);

/** UTC bounds of a Europe/London calendar day — DST-correct via the offset trick. */
function londonDayRange(day) {
  const [y, m, d] = day.split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d));
  const off = (dt) => {
    const p = {};
    for (const { type, value } of new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/London",
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(dt))
      p[type] = value;
    return (
      Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - dt.getTime()
    );
  };
  const start = new Date(guess.getTime() - off(new Date(guess.getTime() - off(guess))));
  const nextGuess = new Date(Date.UTC(y, m - 1, d + 1));
  const end = new Date(
    nextGuess.getTime() - off(new Date(nextGuess.getTime() - off(nextGuess))),
  );
  return { startUtc: start.toISOString(), endUtc: end.toISOString() };
}

async function main() {
  loadEnvFile();
  const argv = process.argv.slice(2);
  const day = flag(argv, "--date");
  const windowDays = Number(flag(argv, "--window") ?? 14);
  const dryRun = has(argv, "--dry-run");

  const ent = await sm.assertEntitlements();
  if (!ent.ok) {
    console.error(`✗ SportMonks entitlements missing: ${ent.missing.join(", ")}`);
    process.exit(2);
  }

  const from = day ?? ymd(new Date());
  const to = day ?? ymd(new Date(Date.now() + windowDays * 86400000));

  const fixtures = await sm.fixturesBetween(from, to);
  console.error(`· ${from} → ${to}: ${fixtures.length} PL fixtures (${sm.calls()} SportMonks calls)`);

  // A blank window is a legitimate, zero-cost outcome — an international break is
  // not an outage. Say so and stop; do not fabricate work.
  if (!fixtures.length) {
    console.error("· no fixtures in window — nothing to upsert (blank GW / international break)");
    process.exit(0);
  }

  const rows = [];
  for (const f of fixtures) {
    const p = sm.participants(f);
    if (!p) {
      console.error(`  ! fixture ${f.id} has no participants — skipped`);
      continue;
    }
    rows.push({
      fixture_id: f.id,
      season_id: f.season_id ?? null,
      round_name: f.round?.name ?? null,
      home: p.home.name,
      away: p.away.name,
      kickoff_at: new Date(`${String(f.starting_at).replace(" ", "T")}Z`).toISOString(),
    });
  }

  for (const r of rows) {
    console.error(`  ${r.fixture_id}  ${r.kickoff_at}  ${r.home} v ${r.away}  (GW ${r.round_name ?? "?"})`);
  }

  if (dryRun) {
    console.log(JSON.stringify(rows, null, 2));
    process.exit(0);
  }

  await api.upsertFixtures(rows);

  // ASSERT. The upsert returning 200 is not evidence the rows are there.
  const { startUtc } = londonDayRange(from);
  const { endUtc } = londonDayRange(to);
  const back = await api.readFixtures({ fromUtc: startUtc, toUtc: endUtc });
  const got = new Set(back.map((r) => Number(r.fixture_id)));
  const missing = rows.filter((r) => !got.has(Number(r.fixture_id)));

  if (missing.length) {
    console.error(`✗ ${missing.length} fixture(s) did not land: ${missing.map((r) => r.fixture_id).join(", ")}`);
    process.exit(2);
  }

  console.error(`✓ ${rows.length} fixtures upserted and verified in the DB`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`✗ ${err.message}`);
  process.exit(2);
});
