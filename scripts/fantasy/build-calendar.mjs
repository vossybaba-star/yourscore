/**
 * Build the gameweek calendar from SportMonks — the job nothing in this codebase
 * did until now. `fantasy_gameweeks` was read-only to the whole app: every row in
 * prod was typed in by hand, and nothing ever wrote a deadline.
 *
 * The deadline is the load-bearing number in the game, so it is derived, never
 * typed: DEADLINE = the round's FIRST KICKOFF − 90 minutes (design D:276-279 —
 * FPL's own convention, so users' muscle memory transfers).
 *
 * Two things this must get right, and both have bitten already:
 *   - SportMonks `starting_at` is UTC. A 14:00 value is the classic 3pm Saturday
 *     kickoff in British Summer Time. Store the instant; never a wall-clock time.
 *   - The round's own `starting_at` is a DATE, not a kickoff. Using it would put
 *     the deadline at midnight. Always take the earliest fixture.
 *
 * Re-runnable by design: the PL moves fixtures for TV all season, so this is a
 * cron, not a one-shot seed. It will NEVER move a deadline that has already
 * passed — that would retroactively re-open or re-close a gameweek people have
 * already played.
 *
 *   node --env-file=.env.local scripts/fantasy/build-calendar.mjs --season 28083
 *   node --env-file=.env.local scripts/fantasy/build-calendar.mjs --season 28083 --apply
 */
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SEASON_ID = Number(arg("--season", "28083"));
const SEASON_LABEL = arg("--label", "2026/27");
const APPLY = args.includes("--apply");
const DEADLINE_LEAD_MIN = 90;

const KEY = process.env.SPORTMONKS_API_KEY;
if (!KEY) throw new Error("SPORTMONKS_API_KEY missing");

/** SportMonks hands back "2026-08-21 19:00:00" with no zone marker — it is UTC. */
const asUtc = (s) => new Date(`${s.replace(" ", "T")}Z`);
const ymd = (d) => d.toISOString().slice(0, 10);

const res = await fetch(
  `https://api.sportmonks.com/v3/football/rounds/seasons/${SEASON_ID}?api_token=${KEY}&include=fixtures`,
);
const body = await res.json();
if (!body.data?.length) throw new Error(`no rounds for season ${SEASON_ID}: ${body.message ?? res.status}`);

const rows = [];
const skipped = [];
for (const r of body.data) {
  const gw = Number(r.name);
  const kickoffs = (r.fixtures ?? []).map((f) => f.starting_at).filter(Boolean).sort();
  if (!Number.isInteger(gw) || !kickoffs.length) {
    skipped.push({ gw: r.name, why: !kickoffs.length ? "no fixtures with a kickoff time yet" : "round name is not a gameweek number" });
    continue;
  }
  const first = asUtc(kickoffs[0]);
  const last = asUtc(kickoffs[kickoffs.length - 1]);
  rows.push({
    gw,
    season: SEASON_LABEL,
    mode: "live",
    window_start: ymd(first),
    window_end: ymd(last),
    deadline: new Date(first.getTime() - DEADLINE_LEAD_MIN * 60_000).toISOString(),
    sm_season_id: SEASON_ID,
    fixtures: kickoffs.length,
  });
}
rows.sort((a, b) => a.gw - b.gw);

const fmt = (iso) => new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
console.log(`season ${SEASON_ID} (${SEASON_LABEL}) — ${rows.length} gameweeks\n`);
console.log("GW  DEADLINE (UK)              FIXTURES  WINDOW");
for (const r of rows) {
  console.log(`${String(r.gw).padStart(2)}  ${fmt(r.deadline).padEnd(24)}  ${String(r.fixtures).padStart(2)}       ${r.window_start} → ${r.window_end}`);
}
// A blank/double gameweek is legitimate (D:303-304); a round with NO fixtures at
// all means the PL hasn't published it, and writing a null deadline would be worse
// than writing nothing.
for (const s of skipped) console.log(`\n⚠️  GW ${s.gw} skipped — ${s.why}`);

if (!APPLY) {
  console.log(`\n(dry run — nothing written. Re-run with --apply to upsert ${rows.length} gameweeks.)`);
  process.exit(0);
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Never move a deadline that has already passed: a gameweek people have already
// played must not be re-opened or re-closed by a fixture reshuffle upstream.
const { data: existing } = await db.from("fantasy_gameweeks").select("gw, deadline, status");
const now = Date.now();
const frozen = new Map(
  (existing ?? [])
    .filter((e) => e.deadline && new Date(e.deadline).getTime() <= now)
    .map((e) => [e.gw, e]),
);
const statusOf = new Map((existing ?? []).map((e) => [e.gw, e.status]));

let written = 0, held = 0;
for (const r of rows) {
  const { fixtures: _fixtures, ...row } = r;
  if (frozen.has(r.gw)) {
    const f = frozen.get(r.gw);
    if (f.deadline !== row.deadline) {
      console.log(`   holding GW ${r.gw}: deadline already passed — keeping ${fmt(f.deadline)}`);
      held++;
    }
    row.deadline = f.deadline;
  }
  // Preserve a status the state machine has already advanced (locked/scored/final).
  row.status = statusOf.get(r.gw) ?? "open";
  const { error } = await db.from("fantasy_gameweeks").upsert(row, { onConflict: "gw" });
  if (error) throw new Error(`gw ${r.gw}: ${error.message}`);
  written++;
}
console.log(`\n✅ ${written} gameweeks written${held ? ` · ${held} past deadlines held` : ""}`);
