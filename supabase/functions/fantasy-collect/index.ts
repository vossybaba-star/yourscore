// Fantasy Assistant forward collection — hosted.
//
// Replaces the laptop cron. Captures deadline-correct FPL projections/injuries/
// prices and SportMonks pre-match odds into the append-only tables from
// migration 103, and records every tick (including skips) in
// fantasy_collection_run so a silently dead collector is detectable.
//
// Throttle is deadline-relative and mirrors src/collect/schedule.py:
//   >72h -> daily | 24-72h -> 6h | 1-24h -> hourly | <60m -> 15m (final freeze)
// Anything past the deadline is still captured but flagged post_deadline, so it
// can never be mistaken for pre-deadline evidence.
//
// State lives in the DB (last collected run), not on any one machine.
// Secured by a shared secret header; verify_jwt is off so pg_cron can call it.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SM_KEY = Deno.env.get("SPORTMONKS_API_KEY") ?? "";
const CRON_SECRET = Deno.env.get("FANTASY_CRON_SECRET") ?? "";
const PL_SEASON = 28083; // 2026/27, verified current
const REST = `${SUPABASE_URL}/rest/v1`;

const RELEVANT = ["Fulltime Result", "Goals Over/Under", "Both Teams To Score",
  "Total - Home", "Total - Away", "Clean Sheet", "Team To Score"];

const hdrs = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

async function insertRows(table: string, rows: unknown[], onConflict?: string) {
  if (!rows.length) return 0;
  let sent = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const url = `${REST}/${table}` + (onConflict ? `?on_conflict=${onConflict}` : "");
    const r = await fetch(url, {
      method: "POST",
      headers: {
        ...hdrs,
        Prefer: "return=minimal" + (onConflict ? ",resolution=ignore-duplicates" : ""),
      },
      body: JSON.stringify(chunk),
    });
    if (!r.ok) throw new Error(`${table} insert ${r.status}: ${(await r.text()).slice(0, 300)}`);
    sent += chunk.length;
  }
  return sent;
}

/** Fetch JSON with bounded retry. A transient upstream blip must not cost us a
 *  pre-deadline snapshot — those are unrecoverable, and one such failure was
 *  observed in testing on a cold start. */
async function fetchJson(url: string, tries = 4): Promise<any> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "yourscore-fantasy" } });
      if (r.status === 429 || r.status === 403 || r.status >= 500) {
        // FPL rate-limits under load (observed live). Honour Retry-After when it
        // is offered rather than guessing, and never hammer a 429 back.
        const ra = Number(r.headers.get("retry-after"));
        const waitMs = Number.isFinite(ra) && ra > 0
          ? Math.min(ra * 1000, 30_000)
          : jittered(i);
        if (i < tries - 1) { await sleep(waitMs); continue; }
        throw new Error(`HTTP ${r.status} (gave up after ${tries})`);
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const text = await r.text();
      if (!text) throw new Error("empty body");
      return JSON.parse(text);
    } catch (e) {
      last = e;
      if (i < tries - 1) await sleep(jittered(i));
    }
  }
  throw new Error(`fetch failed after ${tries} attempts: ${last}`);
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

/** Exponential backoff with jitter: without jitter, several retrying callers
 *  re-collide on exactly the same schedule. */
function jittered(attempt: number): number {
  const base = [500, 2000, 6000, 15000][Math.min(attempt, 3)];
  return base + Math.floor(Math.random() * base * 0.5);
}

function intervalMinutes(h: number | null): number {
  if (h === null) return 1440;
  if (h < 0) return 1440;
  if (h <= 1) return 15;
  if (h <= 24) return 60;
  if (h <= 72) return 360;
  return 1440;
}

function band(h: number | null): string {
  if (h === null) return "daily";
  if (h < 0) return "post-deadline";
  if (h <= 1) return "final-15m";
  if (h <= 24) return "hourly";
  if (h <= 72) return "6-hourly";
  return "daily";
}

const num = (x: unknown) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};

Deno.serve(async (req) => {
  if (CRON_SECRET && req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  const started = new Date().toISOString();
  const force = new URL(req.url).searchParams.get("force") === "1";
  const out: Record<string, unknown> = { started };

  try {
    // --- FPL bootstrap (source of the deadline too) ---
    const boot = await fetchJson("https://fantasy.premierleague.com/api/bootstrap-static/");
    const events = boot.events ?? [];
    const cur = events.find((e: any) => e.is_current)?.id ?? null;
    const nxt = events.find((e: any) => e.is_next)?.id ?? null;
    const deadline = events.find((e: any) => e.is_next)?.deadline_time ?? null;
    const h = deadline ? (new Date(deadline).getTime() - Date.now()) / 3.6e6 : null;
    out.band = band(h);
    out.hours_to_deadline = h === null ? null : Math.round(h * 100) / 100;
    out.post_deadline = h !== null && h < 0;

    // --- throttle from DB state ---
    const lastRes = await fetch(
      `${REST}/fantasy_collection_run?collected=eq.true&order=started_at.desc&limit=1&select=started_at`,
      { headers: hdrs });
    const last = (await lastRes.json())[0]?.started_at ?? null;
    const sinceMin = last ? (Date.now() - new Date(last).getTime()) / 60000 : null;
    // Single-flight guard: a duplicated scheduler tick (or a manual run landing
    // on top of a scheduled one) must not produce two concurrent collections,
    // which is what turns a rate-limit warning into a rate-limit block.
    const inflightRes = await fetch(
      `${REST}/fantasy_collection_run?finished_at=is.null&order=started_at.desc&limit=1&select=started_at`,
      { headers: hdrs });
    const inflight = (await inflightRes.json())[0]?.started_at ?? null;
    const inflightAgeMin = inflight ? (Date.now() - new Date(inflight).getTime()) / 60000 : null;
    if (inflightAgeMin !== null && inflightAgeMin < 5) {
      out.collect = false;
      out.skipped_reason = "another collection is already in flight";
      out.ok = true;
      out.finished = new Date().toISOString();
      return new Response(JSON.stringify(out, null, 2), { headers: { "Content-Type": "application/json" } });
    }

    const due = force || sinceMin === null || sinceMin >= intervalMinutes(h);
    out.collect = due;
    out.minutes_since_last = sinceMin === null ? null : Math.round(sinceMin * 10) / 10;

    if (due) {
      const capturedAt = new Date().toISOString();
      const pos: Record<number, string> = { 1: "GK", 2: "DEF", 3: "MID", 4: "FWD" };
      const rows = (boot.elements ?? []).map((e: any) => ({
        captured_at: capturedAt, current_event: cur, next_event: nxt, next_deadline: deadline,
        player_id: e.id, web_name: e.web_name, team: e.team, position: pos[e.element_type] ?? null,
        now_cost: e.now_cost, selected_by_percent: num(e.selected_by_percent),
        ep_this: num(e.ep_this), ep_next: num(e.ep_next), form: num(e.form),
        status: e.status, news: e.news,
        chance_of_playing_this_round: e.chance_of_playing_this_round,
        chance_of_playing_next_round: e.chance_of_playing_next_round,
        transfers_in_event: e.transfers_in_event, transfers_out_event: e.transfers_out_event,
      }));
      out.fpl_rows = await insertRows("fantasy_fpl_snapshot", rows, "captured_at,player_id");

      // --- fixtures: EXPLANATION context only, never a scoring input ---
      // Same capturedAt as the player rows so a recommendation's fixture context
      // and its player data always come from one coherent moment.
      const teamName: Record<number, string> = {};
      // full names, not short codes: "Home to Everton" is the point, "Home to EVE" is not
      for (const t of boot.teams ?? []) teamName[t.id] = t.name ?? t.short_name;
      const fixtures = await fetchJson("https://fantasy.premierleague.com/api/fixtures/");
      const fxRows = (fixtures ?? [])
        .filter((f: any) => f.event)   // unscheduled fixtures have no gameweek yet
        .map((f: any) => ({
          captured_at: capturedAt, fixture_id: f.id, event: f.event,
          team_h: f.team_h, team_a: f.team_a,
          team_h_name: teamName[f.team_h] ?? null, team_a_name: teamName[f.team_a] ?? null,
          kickoff_time: f.kickoff_time, finished: f.finished,
          provisional_start_time: f.provisional_start_time,
          team_h_difficulty: f.team_h_difficulty, team_a_difficulty: f.team_a_difficulty,
        }));
      out.fixture_rows = await insertRows("fantasy_fixture_snapshot", fxRows, "captured_at,fixture_id");

      // --- SportMonks pre-match odds for upcoming fixtures ---
      let oddsRows = 0;
      if (SM_KEY) {
        const sched = await fetchJson(
          `https://api.sportmonks.com/v3/football/schedules/seasons/${PL_SEASON}?api_token=${SM_KEY}`);
        const smFixtures: { id: number; ko: string | null }[] = [];
        for (const stage of sched.data ?? []) {
          for (const r of stage.rounds ?? []) {
            if (r.finished) continue;
            for (const f of r.fixtures ?? []) smFixtures.push({ id: f.id, ko: f.starting_at ?? null });
          }
        }
        smFixtures.sort((a, b) => (a.ko ?? "").localeCompare(b.ko ?? ""));
        const collectedAt = new Date().toISOString();
        const batch: unknown[] = [];
        for (const fx of smFixtures.slice(0, 20)) {
          const od = await fetchJson(
            `https://api.sportmonks.com/v3/football/odds/pre-match/fixtures/${fx.id}?include=market;bookmaker&api_token=${SM_KEY}`);
          for (const o of od.data ?? []) {
            const desc = o.market_description ?? "";
            if (!RELEVANT.some((k) => desc.includes(k))) continue;
            const dec = num(o.value ?? o.dp3);
            batch.push({
              collected_at: collectedAt, fixture_id: fx.id, fixture_kickoff: fx.ko,
              market_id: o.market_id, market_description: desc, bookmaker_id: o.bookmaker_id,
              selection: o.label, handicap: o.total ?? o.handicap ?? null,
              odds: dec, odds_probability_raw: dec ? Math.round((1 / dec) * 1e5) / 1e5 : null,
              source_updated_at: o.latest_bookmaker_update ?? o.updated_at ?? null,
            });
          }
        }
        oddsRows = await insertRows("fantasy_odds_snapshot", batch,
          "collected_at,fixture_id,market_id,bookmaker_id,selection,handicap");
      }
      out.odds_rows = oddsRows;
    }
    out.ok = true;
  } catch (e) {
    out.ok = false;
    out.error = `${e}`.slice(0, 500);
  }

  out.finished = new Date().toISOString();
  try {
    await insertRows("fantasy_collection_run", [{
      started_at: started, finished_at: out.finished, band: out.band,
      hours_to_deadline: out.hours_to_deadline, collected: !!out.collect,
      post_deadline: !!out.post_deadline, ok: !!out.ok,
      fpl_rows: out.fpl_rows ?? null, odds_rows: out.odds_rows ?? null,
      error: out.error ?? null,
    }]);
  } catch (_) { /* run-history failure must not mask the collection result */ }

  return new Response(JSON.stringify(out, null, 2),
    { headers: { "Content-Type": "application/json" }, status: out.ok ? 200 : 500 });
});
