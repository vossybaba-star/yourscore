/**
 * compute-send-times.mjs — infer each user's habitual play hour (UTC) from
 * history and write it to profiles.active_hour_utc. The notification crons use
 * it to send at the hour a user actually plays, not a global blast time.
 *
 * A play-hour in UTC already encodes the user's local rhythm, so we never store
 * a timezone — someone who always plays at 19:00 UTC gets pinged at 19:00 UTC.
 *
 * Sources: quiz_attempts.completed_at + draft_matches.played_at, last 28 days.
 * Picks each user's MODAL hour (most-frequent), ties broken toward the later
 * (more evening-ish) hour. Users with <3 plays are left null (use fallback).
 *
 * Usage:
 *   node --env-file=.env.local scripts/compute-send-times.mjs           # dry run
 *   node --env-file=.env.local scripts/compute-send-times.mjs --commit  # write
 *
 * Schedule nightly (cron) once it looks right; for now run by hand.
 */
import { createClient } from "@supabase/supabase-js";

const COMMIT = process.argv.includes("--commit");
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  throw new Error("Missing Supabase env — run with --env-file=.env.local");
}
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const WINDOW_MS = 28 * 24 * 60 * 60 * 1000;
const since = new Date(Date.now() - WINDOW_MS).toISOString();
const MIN_PLAYS = 3;

// userId -> Map<hour, count>
const hist = new Map();
function bump(userId, iso) {
  if (!userId || !iso) return;
  const h = new Date(iso).getUTCHours();
  if (Number.isNaN(h)) return;
  if (!hist.has(userId)) hist.set(userId, new Map());
  const m = hist.get(userId);
  m.set(h, (m.get(h) ?? 0) + 1);
}

async function pageThrough(table, userCol, timeCol) {
  const PAGE = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await db
      .from(table)
      .select(`${userCol}, ${timeCol}`)
      .gte(timeCol, since)
      .range(from, from + PAGE - 1);
    if (error) {
      console.warn(`[send-times] ${table} read failed:`, error.message);
      return;
    }
    if (!data?.length) return;
    for (const row of data) bump(row[userCol], row[timeCol]);
    if (data.length < PAGE) return;
    from += PAGE;
  }
}

console.log(`Reading play history since ${since.slice(0, 10)}…`);
await pageThrough("quiz_attempts", "user_id", "completed_at");
await pageThrough("draft_matches", "challenger_id", "played_at");
await pageThrough("draft_matches", "opponent_id", "played_at");

// Resolve each user's modal hour.
const updates = [];
for (const [userId, hours] of hist) {
  const total = [...hours.values()].reduce((a, b) => a + b, 0);
  if (total < MIN_PLAYS) continue;
  let best = -1;
  let bestCount = -1;
  for (const [h, c] of hours) {
    if (c > bestCount || (c === bestCount && h > best)) {
      best = h;
      bestCount = c;
    }
  }
  updates.push({ id: userId, active_hour_utc: best });
}

console.log(`${hist.size} users with activity · ${updates.length} have >= ${MIN_PLAYS} plays`);
const dist = {};
for (const u of updates) dist[u.active_hour_utc] = (dist[u.active_hour_utc] ?? 0) + 1;
console.log("Hour distribution (UTC):", dist);

if (!COMMIT) {
  console.log("\nDRY RUN — re-run with --commit to write profiles.active_hour_utc.");
  process.exit(0);
}

let written = 0;
for (let i = 0; i < updates.length; i += 200) {
  const chunk = updates.slice(i, i + 200);
  const { error } = await db
    .from("profiles")
    .upsert(chunk, { onConflict: "id" });
  if (error) {
    console.warn("[send-times] upsert chunk failed:", error.message);
  } else {
    written += chunk.length;
  }
}
console.log(`Wrote active_hour_utc for ${written} users.`);
