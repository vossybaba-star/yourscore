/**
 * compute-send-times.mjs — decide each user's notification send hour (UTC),
 * computed in their OWN local time. Assumptions first, real data only when real.
 *
 * People are reliably reachable at local downtime windows — the morning commute,
 * lunch, and the evening after work. A one-off play at an odd hour is NOT a
 * standing preference. So:
 *
 *   1. Find the user's timezone (profiles.timezone, exact IANA; else map from
 *      country; else default Europe/London).
 *   2. Convert their play history into LOCAL hours.
 *   3. If a genuine repeated pattern exists (enough plays, across enough days,
 *      concentrated at one local hour) → send at that real local hour.
 *   4. Otherwise snap to the nearest local downtime WINDOW — commute / lunch /
 *      evening — from their (weak) lean, defaulting to evening.
 *   5. Convert the chosen local hour back to UTC (DST-aware) → active_hour_utc.
 *
 * Because the windows are local, a Lagos user gets their evening, a New York
 * user gets theirs. Re-run nightly so DST shifts and new users stay correct.
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

// ── Local downtime windows (local hour, 24h) ─────────────────────────────────
const MORNING_HOUR = 8;   // commute 07:30–09:00
const LUNCH_HOUR = 13;    // lunch 12:00–13:30
const EVENING_HOUR = 19;  // after work 18:00–21:00 — strongest universal downtime
const MORNING_BAND = [7, 8, 9];
const LUNCH_BAND = [12, 13, 14];
const EVENING_BAND = [18, 19, 20, 21, 22];

// ── "Real pattern" thresholds — what it takes to override the assumption ─────
const STRONG_MIN_PLAYS = 5;
const STRONG_MIN_DAYS = 3;     // modal local hour recurs across ≥3 distinct local days
const STRONG_MIN_SHARE = 0.34; // it's a real plurality, not noise
const BAND_MIN_PLAYS = 2;      // don't snap to a window on a single data point

const DEFAULT_TZ = "Europe/London";
// Coarse country → IANA fallback for users with a country but no exact tz.
const COUNTRY_TZ = {
  GB: "Europe/London", IE: "Europe/Dublin",
  NG: "Africa/Lagos", GH: "Africa/Accra", KE: "Africa/Nairobi", ZA: "Africa/Johannesburg",
  US: "America/New_York", CA: "America/Toronto",
  BR: "America/Sao_Paulo", AR: "America/Argentina/Buenos_Aires",
  IN: "Asia/Kolkata", AU: "Australia/Sydney", DE: "Europe/Berlin", FR: "Europe/Paris", ES: "Europe/Madrid",
};

// ── DST-aware tz helpers (no dependency) ─────────────────────────────────────
const offsetCache = new Map();
function tzOffsetMinutes(tz, date) {
  const key = tz + "|" + date.toISOString().slice(0, 10);
  const hit = offsetCache.get(key);
  if (hit !== undefined) return hit;
  let off = 0;
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    off = Math.round((asUTC - date.getTime()) / 60000); // minutes east of UTC
  } catch {
    off = 0;
  }
  offsetCache.set(key, off);
  return off;
}
function localHourOf(iso, tz) {
  const d = new Date(iso);
  const lm = d.getUTCHours() * 60 + d.getUTCMinutes() + tzOffsetMinutes(tz, d);
  return Math.floor((((lm % 1440) + 1440) % 1440) / 60);
}
function localHourToUtc(localHour, tz, ref) {
  const um = localHour * 60 - tzOffsetMinutes(tz, ref);
  return Math.floor((((um % 1440) + 1440) % 1440) / 60);
}

// ── Load timezones for all profiles ──────────────────────────────────────────
async function loadProfiles() {
  const tzById = new Map();
  const PAGE = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await db.from("profiles").select("id, timezone, country").range(from, from + PAGE - 1);
    if (error) { console.warn("[send-times] profiles read failed:", error.message); break; }
    if (!data?.length) break;
    for (const p of data) {
      const tz = p.timezone || COUNTRY_TZ[p.country] || null;
      tzById.set(p.id, tz); // null = unknown (default applied later)
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return tzById;
}

const since = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString();
const tzById = await loadProfiles();
console.log(`Loaded ${tzById.size} profiles (${[...tzById.values()].filter(Boolean).length} with a known timezone).`);

// ── Build LOCAL-hour activity per user ───────────────────────────────────────
// userId -> { hours:number[24], days:Array<Set<string>> } in the user's local time
const hist = new Map();
function bump(userId, iso) {
  if (!userId || !iso) return;
  const tz = tzById.get(userId) || DEFAULT_TZ;
  const h = localHourOf(iso, tz);
  if (Number.isNaN(h)) return;
  // local day key for the distinct-days guard
  const d = new Date(iso);
  const lm = d.getUTCHours() * 60 + d.getUTCMinutes() + tzOffsetMinutes(tz, d);
  const dayShift = lm < 0 ? -1 : lm >= 1440 ? 1 : 0;
  const dayKey = new Date(d.getTime() + dayShift * 86400000).toISOString().slice(0, 10);
  if (!hist.has(userId)) hist.set(userId, { hours: new Array(24).fill(0), days: Array.from({ length: 24 }, () => new Set()) });
  const u = hist.get(userId);
  u.hours[h] += 1;
  u.days[h].add(dayKey);
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

// ── Resolve each user's local send hour, then → UTC ──────────────────────────
const sumBand = (arr, band) => band.reduce((a, h) => a + arr[h], 0);
const now = new Date();
const updates = [];
const reasons = { strong: 0, morning: 0, lunch: 0, evening: 0 };

// Everyone we have EITHER a timezone OR activity for gets a send hour.
const candidates = new Set([...hist.keys(), ...[...tzById.entries()].filter(([, tz]) => tz).map(([id]) => id)]);

for (const userId of candidates) {
  const tz = tzById.get(userId) || DEFAULT_TZ;
  const u = hist.get(userId);
  let localHour;

  if (u) {
    const total = u.hours.reduce((a, b) => a + b, 0);
    let modal = 0, modalCount = -1;
    for (let h = 0; h < 24; h++) if (u.hours[h] > modalCount || (u.hours[h] === modalCount && h > modal)) { modal = h; modalCount = u.hours[h]; }
    const strong = total >= STRONG_MIN_PLAYS && u.days[modal].size >= STRONG_MIN_DAYS && modalCount / total >= STRONG_MIN_SHARE;
    if (strong) {
      localHour = modal; reasons.strong++;
    } else {
      const m = sumBand(u.hours, MORNING_BAND);
      const l = sumBand(u.hours, LUNCH_BAND);
      const e = sumBand(u.hours, EVENING_BAND);
      const best = Math.max(m, l, e);
      if (best >= BAND_MIN_PLAYS && best === e) { localHour = EVENING_HOUR; reasons.evening++; }
      else if (best >= BAND_MIN_PLAYS && best === l) { localHour = LUNCH_HOUR; reasons.lunch++; }
      else if (best >= BAND_MIN_PLAYS && best === m) { localHour = MORNING_HOUR; reasons.morning++; }
      else { localHour = EVENING_HOUR; reasons.evening++; } // no clear lean → safe default
    }
  } else {
    localHour = EVENING_HOUR; reasons.evening++; // tz known, no plays → their evening
  }

  updates.push({ id: userId, active_hour_utc: localHourToUtc(localHour, tz, now) });
}

console.log(`${candidates.size} users assigned a send hour:`);
console.log(`  real pattern: ${reasons.strong} · morning(${MORNING_HOUR}): ${reasons.morning} · lunch(${LUNCH_HOUR}): ${reasons.lunch} · evening(${EVENING_HOUR}): ${reasons.evening}  (all LOCAL, stored as UTC)`);
const utcDist = {};
for (const u of updates) utcDist[u.active_hour_utc] = (utcDist[u.active_hour_utc] ?? 0) + 1;
console.log("  resulting active_hour_utc distribution:", utcDist);

if (!COMMIT) { console.log("\nDRY RUN — re-run with --commit to write profiles.active_hour_utc."); process.exit(0); }

let written = 0;
for (let i = 0; i < updates.length; i += 200) {
  const chunk = updates.slice(i, i + 200);
  const { error } = await db.from("profiles").upsert(chunk, { onConflict: "id" });
  if (error) console.warn("[send-times] upsert chunk failed:", error.message);
  else written += chunk.length;
}
console.log(`Wrote active_hour_utc for ${written} users.`);
