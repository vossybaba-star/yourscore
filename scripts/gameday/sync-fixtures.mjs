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
 * changes nothing (AC29). Kick-off changes overwrite kickoff_at.
 *
 * FIX P2-b (publish_at): computed HERE, at sync, from the gameday shared
 * derivation (09:00 Europe/London the day before kickoff's London date) — and
 * RECOMPUTED on every sync, so a moved kickoff moves the publish time even for
 * a fixture that already has a row. The approve gate (content/route.ts
 * opApprove) recomputes it again at approval time from whatever kickoff_at is
 * current then, so the two never disagree as long as nothing moves the
 * kickoff between sync and gate.
 *
 * FIX P2-a (reschedule re-entry): a fixture that was `cancelled` (postponed)
 * and reappears in the window on a NEW kickoff date must re-enter the
 * pipeline rather than sit cancelled forever. Detected by reading existing
 * rows for this batch's fixture_ids BEFORE the upsert (readFixturesByIds —
 * readFixtures()'s kickoff_at range can't see a row whose OLD kickoff falls
 * outside today's window). If an existing row is `cancelled` and the incoming
 * kickoff differs, the upsert resets it to `scheduled` — legal per the
 * TRANSITIONS map in src/lib/gameday/shared.ts (cancelled → scheduled, the
 * one exception carved out for exactly this case).
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

import * as sm from "../halftime/lib/sm.mjs";
import * as api from "../halftime/lib/api.mjs";
import { loadEnvFile, flag, has } from "../halftime/lib/env.mjs";
import { publishAtFor } from "../../src/lib/gameday/shared.ts";

/** SportMonks round.name is a plain integer string ("1") — verified 2026-07-23. */
export function parseGameweek(roundName) {
  const n = Number.parseInt(String(roundName ?? ""), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * FIX P2-a, pure decision: which incoming rows need their existing DB row
 * reset from cancelled back to scheduled? Extracted so the reschedule logic
 * is unit-testable (node --test) without a live Supabase round trip.
 *
 * @param {Array<{fixture_id:number, kickoff_at:string}>} rows        incoming, this sync
 * @param {Map<number, {state:string, kickoff_at:string}>} existingById  keyed by fixture_id
 * @returns {Array<{fixture_id:number, state:'scheduled'}>}
 */
export function decideReentries(rows, existingById) {
  const out = [];
  for (const r of rows) {
    const existing = existingById.get(Number(r.fixture_id));
    if (existing?.state === "cancelled" && existing.kickoff_at !== r.kickoff_at) {
      out.push({ fixture_id: r.fixture_id, state: "scheduled" });
    }
  }
  return out;
}

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
    const kickoffAt = new Date(`${String(f.starting_at).replace(" ", "T")}Z`).toISOString();
    rows.push({
      fixture_id: f.id,
      season_id: f.season_id ?? null,
      round_name: f.round?.name ?? null,
      gameweek: parseGameweek(f.round?.name),
      home: p.home.name,
      away: p.away.name,
      kickoff_at: kickoffAt,
      // FIX P2-b: recomputed every sync from the CURRENT kickoff, always.
      publish_at: publishAtFor(kickoffAt),
    });
  }

  // FIX P2-a: read what's already there for these exact fixture_ids BEFORE
  // upserting, so a cancelled row whose kickoff has moved can be reset.
  // readFixtures()'s date-range read can't see it — the old kickoff_at may
  // fall well outside this sync's window (that's exactly what postponement
  // to a new date looks like).
  const existingById = new Map();
  if (!dryRun) {
    const existing = await api.readFixturesByIds(rows.map((r) => r.fixture_id));
    for (const e of existing) existingById.set(Number(e.fixture_id), e);
  }

  // Deliberately NOT put on the `rows` objects themselves: PostgREST's bulk
  // upsert builds ONE insert statement whose column list is the union of keys
  // across the whole JSON array. A `state` key present on only SOME rows
  // would still apply to every row in that same call (missing ⇒ NULL in the
  // VALUES tuple for that row), which would silently wipe every other
  // fixture's state on every sync that happens to contain one reschedule.
  // So the reset is a SEPARATE, second, small upsert — uniform shape, only
  // the rows that need it.
  const reentries = decideReentries(rows, existingById);
  for (const r of reentries) {
    const existing = existingById.get(r.fixture_id);
    console.error(
      `  ↻ fixture ${r.fixture_id} was cancelled, kickoff moved (${existing.kickoff_at} → ${rows.find((x) => x.fixture_id === r.fixture_id)?.kickoff_at}) — re-entering at 'scheduled'`,
    );
  }

  for (const r of rows) {
    console.error(`  ${r.fixture_id}  ${r.kickoff_at}  ${r.home} v ${r.away}  (GW ${r.gameweek ?? "?"})`);
  }

  if (dryRun) {
    console.log(JSON.stringify({ rows, reentries }, null, 2));
    process.exit(0);
  }

  await api.upsertFixtures(rows);
  if (reentries.length) {
    await api.upsertFixtures(reentries);
    console.error(`· ${reentries.length} cancelled fixture(s) re-entered the pipeline (rescheduled)`);
  }

  // ASSERT. The upsert returning 200 is not evidence the rows are there.
  const { startUtc } = londonDayRange(from);
  const { endUtc } = londonDayRange(to);
  const back = await api.readFixtures({ fromUtc: startUtc, toUtc: endUtc });
  const got = new Set(back.map((r) => Number(r.fixture_id)));
  const missing = rows.filter((r) => !got.has(Number(r.fixture_id)));

  // Re-verify the re-entries specifically: state really flipped back.
  if (reentries.length) {
    const reentryIds = reentries.map((r) => r.fixture_id);
    const backReentries = await api.readFixturesByIds(reentryIds);
    const stillCancelled = backReentries.filter((r) => r.state === "cancelled");
    if (stillCancelled.length) {
      console.error(
        `✗ ${stillCancelled.length} re-entry(ies) did not take: ${stillCancelled.map((r) => r.fixture_id).join(", ")}`,
      );
      process.exit(2);
    }
  }

  if (missing.length) {
    console.error(`✗ ${missing.length} fixture(s) did not land: ${missing.map((r) => r.fixture_id).join(", ")}`);
    process.exit(2);
  }

  console.error(`✓ ${rows.length} fixtures upserted and verified in the DB`);
  process.exit(0);
}

// CLI-only entrypoint: `main()` reaches out to SportMonks/Supabase, so it must
// not fire on a plain `import` (sync-fixtures.test.mjs imports parseGameweek/
// decideReentries for unit testing and must not trigger a live sync).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`✗ ${err.message}`);
    process.exit(2);
  });
}
