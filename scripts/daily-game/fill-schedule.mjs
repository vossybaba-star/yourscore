#!/usr/bin/env node
/**
 * fill-schedule.mjs — fills the next 14 days of `daily_games` (the "Today's
 * Game" home-hero schedule) so fill-ahead never falls behind and the home
 * page never has to fall back to the featured pack for lack of a row.
 *
 * Week shape (founder-locked; MUST match src/lib/daily-game.ts exactly —
 * duplicated here in plain JS since this script can't import the app's
 * TS path-aliased modules):
 *   Mon / Tue / Thu / Sat / Sun -> quiz
 *   Wed                         -> perfect-10 (defers to Perfect 10's own
 *                                   day-gating — this script does not touch
 *                                   p10_lists, just marks the day as a
 *                                   perfect-10 day)
 *   Fri                         -> alternates by ISO-week parity:
 *                                   even week -> higher-lower
 *                                   odd week  -> guess-the-player
 *
 * Quiz-day pack selection — ELIGIBLE pool only:
 *   - status = 'published'
 *   - type IN ('records', 'national')  — type='club' is ALWAYS excluded.
 *     Club packs are club-specific and unplayable for a neutral fan; this
 *     is a hard rule, not a preference.
 *   - DIFFICULTY GUARD: a pack is excluded if it has >= 5 quiz_attempts AND
 *     its average (correct_count / question_count) is below 0.4. Packs with
 *     < 5 attempts are ALLOWED — unmeasured is not the same as bad.
 *   Ordered by least-recently-featured (packs never used in daily_games
 *   sort first; then oldest last-used first), so the rotation spreads load
 *   across the whole eligible pool instead of repeating favourites.
 *
 * Idempotent: a day that ALREADY has a `daily_games` row (any source —
 * 'auto' or a founder 'override') is left untouched. Only days with no row
 * at all get filled. Re-running this script is always safe.
 *
 * Usage:
 *   node --env-file=.env.local scripts/daily-game/fill-schedule.mjs            # DRY RUN
 *   node --env-file=.env.local scripts/daily-game/fill-schedule.mjs --commit   # write
 *
 * Never prints secrets — only pack names/ids and dates.
 */

import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const COMMIT = args.includes("--commit");
const DAYS_AHEAD = 14;
const MIN_ATTEMPTS_FOR_GUARD = 5;
const MIN_AVG_RATIO = 0.4;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — run with --env-file=.env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ── Week shape (mirrors src/lib/daily-game.ts) ──────────────────────────────

function isoWeekNumber(dateISO) {
  const d = new Date(`${dateISO}T00:00:00Z`);
  const isoDay = d.getUTCDay() || 7; // Mon=1 .. Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - isoDay);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

function gameTypeForDay(dateISO) {
  const weekday = new Date(`${dateISO}T00:00:00Z`).getUTCDay(); // 0=Sun..6=Sat
  if (weekday === 3) return "perfect-10";
  if (weekday === 5) return isoWeekNumber(dateISO) % 2 === 0 ? "higher-lower" : "guess-the-player";
  return "quiz";
}

function londonDateISO(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDays(dateISO, n) {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ── Main ─────────────────────────────────────────────────────────────────

const today = londonDateISO();
const windowDays = Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(today, i));

// 1. Which days already have a row (any source)? Skip those — idempotent.
const { data: existingRows, error: existingErr } = await supabase
  .from("daily_games")
  .select("day, source")
  .gte("day", windowDays[0])
  .lte("day", windowDays[windowDays.length - 1]);

if (existingErr) {
  console.error("Failed to read daily_games (has migration 101_daily_games.sql been applied?):", existingErr.message);
  process.exit(1);
}

const alreadyScheduled = new Set((existingRows ?? []).map((r) => r.day));
const daysToFill = windowDays.filter((d) => !alreadyScheduled.has(d));

if (daysToFill.length === 0) {
  console.log(`All ${DAYS_AHEAD} days (${windowDays[0]} .. ${windowDays[windowDays.length - 1]}) already scheduled. Nothing to do.`);
  process.exit(0);
}

const quizDays = daysToFill.filter((d) => gameTypeForDay(d) === "quiz");

// 2. Eligible quiz pack pool: published, records/national only — club EXCLUDED.
let eligiblePacks = [];
if (quizDays.length > 0) {
  const { data: pool, error: poolErr } = await supabase
    .from("quiz_packs")
    .select("id, name, type, question_count, status")
    .eq("status", "published")
    .in("type", ["records", "national"]);
  if (poolErr) {
    console.error("Failed to read quiz_packs:", poolErr.message);
    process.exit(1);
  }
  eligiblePacks = (pool ?? []).filter((p) => p.type !== "club"); // belt & braces — the hard rule

  // 3. Difficulty guard — aggregate quiz_attempts per pack.
  const packIds = eligiblePacks.map((p) => p.id);
  if (packIds.length > 0) {
    const { data: attempts, error: attemptsErr } = await supabase
      .from("quiz_attempts")
      .select("pack_id, correct_count")
      .in("pack_id", packIds);
    if (attemptsErr) {
      console.error("Failed to read quiz_attempts for the difficulty guard:", attemptsErr.message);
      process.exit(1);
    }
    const byPack = new Map(); // pack_id -> { sum, count }
    for (const a of attempts ?? []) {
      const agg = byPack.get(a.pack_id) ?? { sum: 0, count: 0 };
      agg.sum += Number(a.correct_count ?? 0);
      agg.count += 1;
      byPack.set(a.pack_id, agg);
    }
    const excludedForDifficulty = [];
    eligiblePacks = eligiblePacks.filter((p) => {
      const agg = byPack.get(p.id);
      if (!agg || agg.count < MIN_ATTEMPTS_FOR_GUARD) return true; // unmeasured != bad
      const q = Number(p.question_count) || 10;
      const avgRatio = agg.sum / (agg.count * q);
      if (avgRatio < MIN_AVG_RATIO) {
        excludedForDifficulty.push(`${p.name} (${(avgRatio * 100).toFixed(0)}% avg over ${agg.count} attempts)`);
        return false;
      }
      return true;
    });
    if (excludedForDifficulty.length > 0) {
      console.log(`Difficulty guard excluded ${excludedForDifficulty.length} pack(s):`);
      for (const line of excludedForDifficulty) console.log(`  - ${line}`);
    }
  }

  // 4. Least-recently-featured ordering — look at ALL history, not just the fill window.
  const { data: history, error: historyErr } = await supabase
    .from("daily_games")
    .select("pack_id, day")
    .eq("game_type", "quiz")
    .not("pack_id", "is", null)
    .order("day", { ascending: false });
  if (historyErr) {
    console.error("Failed to read daily_games history:", historyErr.message);
    process.exit(1);
  }
  const lastUsed = new Map(); // pack_id -> most recent day used
  for (const row of history ?? []) {
    if (!lastUsed.has(row.pack_id)) lastUsed.set(row.pack_id, row.day); // first hit = most recent (sorted desc)
  }
  eligiblePacks.sort((a, b) => {
    const da = lastUsed.get(a.id) ?? ""; // never used sorts first (empty < any date)
    const db = lastUsed.get(b.id) ?? "";
    if (da !== db) return da < db ? -1 : 1;
    return a.name.localeCompare(b.name); // deterministic tie-break
  });
}

if (quizDays.length > 0 && eligiblePacks.length === 0) {
  console.error("No eligible quiz packs found (published, type in records/national, passing the difficulty guard) — cannot fill quiz days.");
}

// 5. Assign packs to quiz-day slots, in order, no repeats within this run
//    unless the pool is smaller than the number of quiz days (then wrap).
const planned = [];
let cursor = 0;
for (const day of daysToFill) {
  const gameType = gameTypeForDay(day);
  if (gameType !== "quiz") {
    planned.push({ day, game_type: gameType, pack_id: null, source: "auto" });
    continue;
  }
  if (eligiblePacks.length === 0) {
    console.log(`  SKIP ${day} (quiz) — no eligible pack available`);
    continue;
  }
  const pack = eligiblePacks[cursor % eligiblePacks.length];
  cursor++;
  planned.push({ day, game_type: "quiz", pack_id: pack.id, source: "auto", _packName: pack.name });
}

// 6. Report + write.
console.log(`Today (Europe/London): ${today}`);
console.log(`Window: ${windowDays[0]} .. ${windowDays[windowDays.length - 1]}`);
console.log(`Already scheduled: ${alreadyScheduled.size}/${DAYS_AHEAD} — filling ${planned.length} day(s)${COMMIT ? "" : " (DRY RUN)"}:\n`);
for (const row of planned) {
  const label = row.game_type === "quiz" ? `quiz — ${row._packName}` : row.game_type;
  console.log(`  ${row.day}  ${label}`);
}

if (planned.length === 0) {
  console.log("\nNothing to write.");
  process.exit(0);
}

if (!COMMIT) {
  console.log("\nDRY RUN — pass --commit to write these rows.");
  process.exit(0);
}

const rows = planned.map(({ day, game_type, pack_id, source }) => ({ day, game_type, pack_id, source }));
// insert (not upsert) — a day already scheduled is filtered out above, and we
// never want to silently clobber a row a concurrent run just wrote.
const { error: insertErr } = await supabase.from("daily_games").insert(rows);
if (insertErr) {
  console.error("Insert failed:", insertErr.message);
  process.exit(1);
}
console.log(`\nWrote ${rows.length} row(s) to daily_games.`);
