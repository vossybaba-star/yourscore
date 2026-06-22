/**
 * compute-send-times.mjs — decide each user's notification send hour (UTC).
 *
 * Philosophy: ASSUMPTIONS FIRST, data only when it's real.
 * People are reliably free at known downtime windows — lunch and the evening
 * after work. A one-off quiz at 3pm does NOT mean someone is free at 3pm. So:
 *
 *   • Default everyone to an assumed downtime window (LUNCH or EVENING).
 *   • Override with a user's actual hour ONLY when their history shows a
 *     genuine repeated pattern (enough plays, spread across enough distinct
 *     days, concentrated at one hour) — not a single afternoon binge.
 *
 * The windows are anchored to the #1 market (UK ≈ UTC; Nigeria/Ghana are +0/+1,
 * so they fit). Users with a strong real pattern use their true UTC hour, which
 * already encodes their own timezone — so engaged users in any region are right.
 *
 * Sources: quiz_attempts.completed_at + draft_matches.played_at, last 28 days.
 *
 * Usage:
 *   node --env-file=.env.local scripts/compute-send-times.mjs           # dry run
 *   node --env-file=.env.local scripts/compute-send-times.mjs --commit  # write
 */
import { createClient } from "@supabase/supabase-js";

const COMMIT = process.argv.includes("--commit");
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Missing Supabase env — run with --env-file=.env.local");
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// ── Assumed downtime windows (UTC, UK-anchored) ──────────────────────────────
const LUNCH_HOUR = 12;    // ~lunch break
const EVENING_HOUR = 19;  // ~after work — the strongest universal downtime
const LUNCH_BAND = [11, 12, 13, 14];
const EVENING_BAND = [17, 18, 19, 20, 21, 22];

// ── "Real pattern" thresholds — what it takes to override the assumption ─────
const STRONG_MIN_PLAYS = 5;       // enough total signal
const STRONG_MIN_DAYS = 3;        // the modal hour recurs across ≥3 distinct days
const STRONG_MIN_SHARE = 0.34;    // the modal hour is a real plurality, not noise
const LUNCH_MIN_PLAYS = 2;        // don't snap to lunch on a single data point

const WINDOW_MS = 28 * 24 * 60 * 60 * 1000;
const since = new Date(Date.now() - WINDOW_MS).toISOString();

// userId -> { hours: number[24] play counts, daysAtHour: Array<Set<string>> }
const hist = new Map();
function bump(userId, iso) {
  if (!userId || !iso) return;
  const d = new Date(iso);
  const h = d.getUTCHours();
  if (Number.isNaN(h)) return;
  const day = iso.slice(0, 10);
  if (!hist.has(userId)) hist.set(userId, { hours: new Array(24).fill(0), days: Array.from({ length: 24 }, () => new Set()) });
  const u = hist.get(userId);
  u.hours[h] += 1;
  u.days[h].add(day);
}

async function pageThrough(table, userCol, timeCol) {
  const PAGE = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await db.from(table).select(`${userCol}, ${timeCol}`).gte(timeCol, since).range(from, from + PAGE - 1);
    if (error) { console.warn(`[send-times] ${table} read failed:`, error.message); return; }
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

const sum = (arr, band) => band.reduce((a, h) => a + arr[h], 0);

const updates = [];
const reasons = { strong: 0, lunch: 0, evening: 0 };
for (const [userId, u] of hist) {
  const total = u.hours.reduce((a, b) => a + b, 0);
  if (total === 0) continue;

  // Modal hour (ties → later, i.e. more evening-ish).
  let modal = 0, modalCount = -1;
  for (let h = 0; h < 24; h++) if (u.hours[h] > modalCount || (u.hours[h] === modalCount && h > modal)) { modal = h; modalCount = u.hours[h]; }

  const strong =
    total >= STRONG_MIN_PLAYS &&
    u.days[modal].size >= STRONG_MIN_DAYS &&
    modalCount / total >= STRONG_MIN_SHARE;

  let hour;
  if (strong) {
    hour = modal;                         // real, repeated → trust the actual hour
    reasons.strong++;
  } else {
    // No trustworthy pattern → snap to an assumed window. Only choose LUNCH if
    // their (weak) activity clearly leans lunch; otherwise EVENING is the safe
    // downtime default — a random afternoon play does NOT become a 3pm send.
    const lunch = sum(u.hours, LUNCH_BAND);
    const evening = sum(u.hours, EVENING_BAND);
    if (lunch > evening && lunch >= LUNCH_MIN_PLAYS) { hour = LUNCH_HOUR; reasons.lunch++; }
    else { hour = EVENING_HOUR; reasons.evening++; }
  }
  updates.push({ id: userId, active_hour_utc: hour });
}

console.log(`${hist.size} users with activity · ${updates.length} assigned a send hour`);
console.log(`  real repeated pattern: ${reasons.strong}  ·  snapped → lunch(${LUNCH_HOUR}): ${reasons.lunch}  ·  snapped → evening(${EVENING_HOUR}): ${reasons.evening}`);
console.log(`  (users with no plays stay null → cron sends them at the evening fallback)`);

if (!COMMIT) { console.log("\nDRY RUN — re-run with --commit to write profiles.active_hour_utc."); process.exit(0); }

let written = 0;
for (let i = 0; i < updates.length; i += 200) {
  const chunk = updates.slice(i, i + 200);
  const { error } = await db.from("profiles").upsert(chunk, { onConflict: "id" });
  if (error) console.warn("[send-times] upsert chunk failed:", error.message);
  else written += chunk.length;
}
console.log(`Wrote active_hour_utc for ${written} users.`);
