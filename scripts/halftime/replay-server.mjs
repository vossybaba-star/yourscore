#!/usr/bin/env node
/**
 * replay-server.mjs — a SportMonks stand-in that replays a recorded matchday.
 *
 * WHY THIS EXISTS: the 2026/27 season starts 2026-08-21. Until then
 * /livescores returns legitimately empty data and the half-time state flip —
 * the single event this entire feature hangs on — CANNOT be observed. So it is
 * simulated, faithfully, and the poller and the Vercel watchdog are pointed at
 * this server through the one seam they already have:
 *
 *     SPORTMONKS_BASE_URL=http://127.0.0.1:8787
 *
 * Neither the poller nor the app is modified in any way to be tested. That is
 * the whole design: if the code needs a special "replay mode" branch, the thing
 * you tested is not the thing that ships.
 *
 * Usage:
 *   node scripts/halftime/replay-server.mjs --scenario scripts/halftime/scenarios/normal-match.json \
 *        [--scale 60] [--port 8787]
 *
 *   --scale N   compress time by N. At 60, one nominal minute of the scenario
 *               takes one real second, so a Saturday replays in minutes. The
 *               poller gets the same N via HALFTIME_SCALE. At 1 it is real time.
 *
 * Endpoints implemented (exactly the ones the halftime code calls, no more):
 *   GET /v3/my/resources                      entitlement assertion
 *   GET /v3/football/states                   the real catalogue (states.json)
 *   GET /v3/football/livescores/latest        the 6s fast lane
 *   GET /v3/football/livescores/inplay
 *   GET /v3/football/fixtures/multi/{ids}     the by-id lane (watchdog + slow lane)
 *   GET /v3/football/fixtures/{id}            ?include=lineups;participants
 *   GET /v3/football/fixtures/date/{date}
 *   GET /v3/football/fixtures/between/{a}/{b}
 *
 * Harness-only (namespaced so they can never be mistaken for the real API):
 *   GET  /_replay/manifest    fixtures with their REAL iso kickoffs + T0
 *   GET  /_replay/clock       current nominal minute
 *   GET  /_replay/stats       per-endpoint call counts (this is how we prove
 *                             the watchdog's idle path makes ZERO api calls)
 *   POST /_replay/stats/reset
 */

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// ── args ─────────────────────────────────────────────────────────────────────

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const SCENARIO_PATH = arg("scenario");
const SCALE = Number(arg("scale", "60"));
const PORT = Number(arg("port", "8787"));

if (!SCENARIO_PATH) {
  console.error("usage: replay-server.mjs --scenario <file.json> [--scale 60] [--port 8787]");
  process.exit(1);
}
if (!Number.isFinite(SCALE) || SCALE <= 0) {
  console.error(`--scale must be a positive number (got ${SCALE})`);
  process.exit(1);
}

const scenario = JSON.parse(readFileSync(SCENARIO_PATH, "utf8"));

// ── the states catalogue ─────────────────────────────────────────────────────
// Pulled from the LIVE api (GET /v3/football/states) and committed, so a
// scenario names states the way the production code resolves them — by
// developer_name — and can never invent an id that does not exist. If the file
// is missing we refuse to start rather than quietly guessing ids: a wrong id
// here would make the whole suite prove nothing.

const STATES_PATH = join(HERE, "scenarios", "states.json");
if (!existsSync(STATES_PATH)) {
  console.error(`✗ ${STATES_PATH} is missing. Regenerate it from the live API:`);
  console.error(`  node --env-file=.env.local scripts/halftime/record-states.mjs`);
  process.exit(1);
}
const STATES = JSON.parse(readFileSync(STATES_PATH, "utf8"));
const STATE_BY_NAME = new Map(STATES.map((s) => [s.developer_name, s]));

// Sanity: the one id the production code hardcodes.
const HT = STATE_BY_NAME.get("HT");
if (!HT || Number(HT.id) !== 3) {
  console.error(`✗ states.json disagrees with the code: HT is id ${HT?.id}, expected 3`);
  process.exit(1);
}

/** Live states — a fixture in one of these is being updated constantly, so it
 *  is always present in /livescores/latest. Anything else only shows up for the
 *  ~10 seconds after it changed. */
const LIVE_NAMES = new Set([
  "INPLAY_1ST_HALF",
  "HT",
  "INPLAY_2ND_HALF",
  "BREAK",
  "EXTRA_TIME_BREAK",
  "INPLAY_ET",
  "INPLAY_ET_2ND_HALF",
  "PEN_BREAK",
  "AWAITING_PENALTIES",
  "INPLAY_PENALTIES",
]);

/** /livescores/latest = "updated in the last 10 seconds". Ten NOMINAL seconds,
 *  floored so a very aggressive --scale cannot shrink it below a poll tick. */
const LATEST_WINDOW_MS = Math.max(400, (10 * 1000) / SCALE);

// ── the clock ────────────────────────────────────────────────────────────────

const T0 = Date.now();
const nominalMin = () => ((Date.now() - T0) * SCALE) / 60000;
/** A nominal minute offset → a real wall-clock instant. */
const instantOf = (min) => new Date(T0 + (min * 60000) / SCALE);

// ── fixture state ────────────────────────────────────────────────────────────

const stats = Object.create(null);
const bump = (k) => { stats[k] = (stats[k] ?? 0) + 1; };

function kickoffMin(f) {
  const shift = f.kickoff_shift;
  if (shift && nominalMin() >= shift.at_min) return shift.to_min;
  return f.kickoff_min;
}

/** The current timeline entry, and when it started — the recency test needs both. */
function currentEntry(f) {
  const now = nominalMin();
  let entry = f.timeline[0];
  for (const e of f.timeline) {
    if (e.at_min <= now) entry = e;
    else break;
  }
  return entry;
}

function stateOf(f) {
  const st = STATE_BY_NAME.get(currentEntry(f).state);
  if (!st) throw new Error(`scenario names an unknown state: ${currentEntry(f).state}`);
  return st;
}

/** SportMonks serves both a UTC string and a unix timestamp. The string is a
 *  trap ("2026-08-22 14:00:00" parses as LOCAL time in Node) — anything that
 *  needs an instant should use starting_at_timestamp. Both are served here
 *  precisely so that trap is reproducible. */
function startingAt(f) {
  const at = instantOf(kickoffMin(f));
  return {
    starting_at: at.toISOString().replace("T", " ").slice(0, 19),
    starting_at_timestamp: Math.floor(at.getTime() / 1000),
  };
}

function participants(f) {
  return [
    { id: f.id * 10 + 1, name: f.home, meta: { location: "home" } },
    { id: f.id * 10 + 2, name: f.away, meta: { location: "away" } },
  ];
}

function lineupsPublished(f) {
  return f.lineups_at_min != null && nominalMin() >= f.lineups_at_min;
}

/** 11 starters + 7 bench per side, shaped like the real include. */
function lineups(f) {
  if (!lineupsPublished(f)) return [];
  const out = [];
  for (const [side, teamId] of [["home", f.id * 10 + 1], ["away", f.id * 10 + 2]]) {
    for (let i = 1; i <= 18; i++) {
      out.push({
        id: teamId * 100 + i,
        team_id: teamId,
        player_id: teamId * 1000 + i,
        player_name: `${side === "home" ? f.home : f.away} Player ${i}`,
        jersey_number: i,
        type_id: i <= 11 ? 11 : 12, // 11 = lineup (starter), 12 = bench
        formation_field: i <= 11 ? `${i}:1` : null,
        formation_position: i <= 11 ? i : null,
      });
    }
  }
  return out;
}

function baseFixture(f) {
  const st = stateOf(f);
  return {
    id: f.id,
    sport_id: 1,
    league_id: 8,
    season_id: f.season_id ?? 28083,
    name: `${f.home} vs ${f.away}`,
    state_id: Number(st.id),
    ...startingAt(f),
    result_info: null,
    round: f.round ? { id: 1, name: f.round } : null,
  };
}

function withIncludes(f, include) {
  const out = baseFixture(f);
  const inc = String(include ?? "").split(";").map((s) => s.trim()).filter(Boolean);
  if (inc.includes("participants")) out.participants = participants(f);
  if (inc.includes("lineups")) out.lineups = lineups(f);
  if (inc.includes("round")) out.round = f.round ? { id: 1, name: f.round } : null;
  if (inc.includes("state")) out.state = stateOf(f);
  return out;
}

// The last time each fixture changed state, in real ms — this is what makes
// /livescores/latest a *recency* feed rather than a "list every match" feed.
const lastChange = new Map();
const lastSeenState = new Map();
setInterval(() => {
  for (const f of scenario.fixtures) {
    const st = stateOf(f).developer_name;
    if (lastSeenState.get(f.id) !== st) {
      lastSeenState.set(f.id, st);
      lastChange.set(f.id, Date.now());
    }
  }
}, 25).unref();

function inLatestFeed(f) {
  const name = stateOf(f).developer_name;
  if (LIVE_NAMES.has(name)) return true; // being updated every few seconds
  const changed = lastChange.get(f.id);
  return changed != null && Date.now() - changed < LATEST_WINDOW_MS;
}

// ── http ─────────────────────────────────────────────────────────────────────

const json = (res, code, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
};
const ok = (res, data) => json(res, 200, { data, subscription: [], rate_limit: { remaining: 1999 } });

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const p = url.pathname;

  // ── harness-only ───────────────────────────────────────────────────────────
  if (p === "/_replay/manifest") {
    return json(res, 200, {
      scenario: scenario.name,
      scale: SCALE,
      t0: new Date(T0).toISOString(),
      harness: scenario.harness ?? {},
      fixtures: scenario.fixtures.map((f) => ({
        fixture_id: f.id,
        home: f.home,
        away: f.away,
        season_id: f.season_id ?? 28083,
        round_name: f.round ?? null,
        kickoff_min: f.kickoff_min,
        kickoff_at: instantOf(f.kickoff_min).toISOString(),
        ht_min: (f.timeline.find((e) => e.state === "HT") ?? {}).at_min ?? null,
      })),
    });
  }
  if (p === "/_replay/clock") {
    return json(res, 200, {
      nominal_min: Number(nominalMin().toFixed(2)),
      real_elapsed_s: Number(((Date.now() - T0) / 1000).toFixed(1)),
      scale: SCALE,
      states: scenario.fixtures.map((f) => ({
        fixture_id: f.id,
        state: stateOf(f).developer_name,
        state_id: Number(stateOf(f).id),
      })),
    });
  }
  if (p === "/_replay/stats") return json(res, 200, { calls: { ...stats } });
  if (p === "/_replay/stats/reset") {
    for (const k of Object.keys(stats)) delete stats[k];
    return json(res, 200, { ok: true });
  }

  // ── everything below is the SportMonks surface ────────────────────────────
  // The real API 401s without a token. Enforcing it here proves the client
  // actually sends one (and sends it as a header, not in the query string).
  if (!req.headers.authorization) {
    bump("unauthorized");
    return json(res, 401, { message: "Missing api token." });
  }

  if (p === "/v3/my/resources") {
    bump("my/resources");
    return ok(res, [
      { id: 1, name: "livescores" }, { id: 2, name: "states" },
      { id: 3, name: "lineups" }, { id: 4, name: "fixtures" },
      { id: 5, name: "periods" }, { id: 6, name: "statistics" },
      { id: 7, name: "transfers" }, { id: 8, name: "players" },
    ]);
  }

  if (p === "/v3/football/states") {
    bump("states");
    return ok(res, STATES);
  }

  if (p === "/v3/football/livescores/latest") {
    bump("livescores/latest");
    return ok(res, scenario.fixtures.filter(inLatestFeed).map((f) => withIncludes(f, url.searchParams.get("include"))));
  }

  if (p === "/v3/football/livescores/inplay") {
    bump("livescores/inplay");
    const live = scenario.fixtures.filter((f) => LIVE_NAMES.has(stateOf(f).developer_name));
    return ok(res, live.map((f) => withIncludes(f, url.searchParams.get("include"))));
  }

  // /v3/football/fixtures/multi/{id,id,id} — state by id, whatever the state.
  let m = p.match(/^\/v3\/football\/fixtures\/multi\/(.+)$/);
  if (m) {
    bump("fixtures/multi");
    const ids = new Set(m[1].split(",").map((s) => Number(s.trim())));
    const rows = scenario.fixtures.filter((f) => ids.has(Number(f.id)));
    return ok(res, rows.map((f) => withIncludes(f, url.searchParams.get("include"))));
  }

  // /v3/football/fixtures/between/{from}/{to}
  m = p.match(/^\/v3\/football\/fixtures\/between\/([\d-]+)\/([\d-]+)$/);
  if (m) {
    bump("fixtures/between");
    const rows = scenario.fixtures.filter((f) => {
      const d = instantOf(kickoffMin(f)).toISOString().slice(0, 10);
      return d >= m[1] && d <= m[2];
    });
    return ok(res, rows.map((f) => withIncludes(f, url.searchParams.get("include") ?? "participants;round")));
  }

  // /v3/football/fixtures/date/{date}
  m = p.match(/^\/v3\/football\/fixtures\/date\/([\d-]+)$/);
  if (m) {
    bump("fixtures/date");
    const rows = scenario.fixtures.filter(
      (f) => instantOf(kickoffMin(f)).toISOString().slice(0, 10) === m[1],
    );
    return ok(res, rows.map((f) => withIncludes(f, url.searchParams.get("include") ?? "participants;round")));
  }

  // /v3/football/fixtures/{id}
  m = p.match(/^\/v3\/football\/fixtures\/(\d+)$/);
  if (m) {
    bump("fixtures/one");
    const f = scenario.fixtures.find((x) => Number(x.id) === Number(m[1]));
    if (!f) return json(res, 404, { message: "Fixture not found" });
    return ok(res, withIncludes(f, url.searchParams.get("include")));
  }

  bump(`404:${p}`);
  return json(res, 404, { message: `replay-server: no route for ${p}` });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(
    `[replay] "${scenario.name}" · ${scenario.fixtures.length} fixture(s) · scale ${SCALE}x ` +
      `· http://127.0.0.1:${PORT} · T0 ${new Date(T0).toISOString()}`,
  );
  for (const f of scenario.fixtures) {
    const ht = f.timeline.find((e) => e.state === "HT");
    console.log(
      `[replay]   ${f.id} ${f.home} v ${f.away} · KO min ${f.kickoff_min}` +
        (ht ? ` · HT min ${ht.at_min} (KO+${ht.at_min - f.kickoff_min}')` : " · no HT") +
        (f.lineups_at_min == null ? " · no lineups" : ` · XI min ${f.lineups_at_min}`),
    );
  }
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log(`[replay] calls: ${JSON.stringify(stats)}`);
    server.close(() => process.exit(0));
  });
}
