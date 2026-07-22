/**
 * sm.mjs — SportMonks v3 client for the halftime generation scripts.
 *
 * Node twin of src/lib/halftime/sportmonks.ts (that one is `server-only`, so a
 * .mjs script cannot import it). Same seam, same contract:
 *
 *   SPORTMONKS_BASE_URL  — defaults to the real API; the replay harness (W2)
 *                          points it at localhost so these scripts run UNMODIFIED
 *                          against a recorded matchday.
 *
 * Verified against the live API 2026-07-14 (trial key; expires 2026-07-22 —
 * re-run assertEntitlements() on the paid key before the season):
 *   /v3/football/fixtures/between/{from}/{to}          PL fixture list  (200)
 *   /v3/football/fixtures/between/{from}/{to}/{teamId} team fixtures    (200)
 *   /v3/football/fixtures/{id}?include=lineups.player;formations;participants  (200)
 *   /v3/football/fixtures/head-to-head/{a}/{b}?include=events;scores           (200)
 *   /v3/football/players/{id}?include=statistics.details.type;teams;transfers  (200)
 *   /v3/football/squads/teams/{id}?include=player                              (200)
 *   /v3/core/types                                     GOAL=14 OWNGOAL=15 PENALTY=16
 *
 * GOTCHA (cost me a real bug): every list endpoint paginates at 25/page by
 * default and SILENTLY TRUNCATES. `/fixtures/between` over a 14-day window
 * returns 25 of ~30 PL fixtures unless you page. fetchAll() below follows
 * pagination.has_more — never call smFetch() directly on a list endpoint.
 */

const BASE = (process.env.SPORTMONKS_BASE_URL || "https://api.sportmonks.com").replace(/\/$/, "");

export const PL_LEAGUE_ID = 8;

/** Verified via /v3/core/types 2026-07-14. */
export const EVENT_TYPE = { GOAL: 14, OWNGOAL: 15, PENALTY: 16 };

/** Verified via /v3/football/states 2026-07-14: HT is state_id 3. */
export const HALFTIME_STATE_ID = 3;

/** Lineup row types: 11 = starting XI, 12 = bench. */
export const LINEUP_TYPE = { STARTER: 11, BENCH: 12 };

/** statistics.details type ids (verified on a real player-season payload). */
export const STAT = {
  GOALS: 52,
  ASSISTS: 79,
  MINUTES_PLAYED: 119,
  CLEANSHEET: 194,
  APPEARANCES: 321,
  LINEUPS: 322,
  BENCH: 323,
  HATTRICKS: 27259,
  RATING: 118,
  YELLOWCARDS: 84,
};

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = 400;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class SmError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "SmError";
    this.status = status;
  }
}

function token() {
  const t = process.env.SPORTMONKS_API_KEY;
  if (!t) throw new SmError("SPORTMONKS_API_KEY is not set", 0);
  return t;
}

/**
 * In-process response cache. The base miner asks for the same H2H set once per
 * fixture and the fresh miner asks for the same player 2-3 times across reveal
 * types; without this a 10-fixture slate would burn ~4x the calls it needs.
 * Keyed on the full URL. Cleared per process — never persisted.
 */
const cache = new Map();
export function clearCache() {
  cache.clear();
}

let callCount = 0;
export const calls = () => callCount;

/**
 * One page. Token goes in the Authorization header, never the query string, so
 * it cannot leak into a log line or an error message.
 */
async function smFetch(path, params = {}) {
  const url = new URL(path.replace(/^\//, ""), `${BASE}/`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const key = url.toString();
  if (cache.has(key)) return cache.get(key);

  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      callCount++;
      const res = await fetch(key, {
        headers: { Authorization: token(), Accept: "application/json" },
      });
      if (res.ok) {
        const body = await res.json();
        cache.set(key, body);
        return body;
      }
      // 4xx other than 429 is a caller bug — fail fast, no retry.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        throw new SmError(`SportMonks ${res.status} on ${path}`, res.status);
      }
      lastErr = new SmError(`SportMonks ${res.status} on ${path}`, res.status);
    } catch (err) {
      if (err instanceof SmError && err.status >= 400 && err.status < 500 && err.status !== 429) throw err;
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
    if (attempt < MAX_ATTEMPTS) await sleep(BACKOFF_MS * 2 ** (attempt - 1));
  }
  throw lastErr ?? new SmError(`SportMonks request failed: ${path}`, 0);
}

/** Follow pagination to the end. THE only safe way to read a list endpoint. */
async function fetchAll(path, params = {}, cap = 10) {
  const out = [];
  for (let page = 1; page <= cap; page++) {
    const body = await smFetch(path, { ...params, per_page: 50, page });
    const rows = body?.data ?? [];
    out.push(...rows);
    if (!body?.pagination?.has_more) break;
  }
  return out;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** PL fixtures in [from, to] (YYYY-MM-DD). Paginated — a 14-day window overflows one page. */
export async function fixturesBetween(from, to, leagueId = PL_LEAGUE_ID) {
  return fetchAll(`/v3/football/fixtures/between/${from}/${to}`, {
    filters: `fixtureLeagues:${leagueId}`,
    include: "participants;round;league",
  });
}

/**
 * One team's fixtures in a window, WITH the team sheets. This carries the
 * formation baseline AND the start history, so "first start since <date>" is
 * derived from real past line-ups rather than guessed. Verified: 30 fixtures,
 * team sheets present on all 30.
 */
export async function teamFixturesBetween(from, to, teamId) {
  return fetchAll(`/v3/football/fixtures/between/${from}/${to}/${teamId}`, {
    include: "participants;formations;lineups;league",
  });
}

export async function fixture(fixtureId, include = "participants") {
  const body = await smFetch(`/v3/football/fixtures/${fixtureId}`, { include });
  return body?.data ?? null;
}

/** The confirmed team sheets + formations for one fixture. */
export async function fixtureLineup(fixtureId) {
  return fixture(fixtureId, "participants;lineups.player;formations;round;league;venue");
}

/** Every recorded meeting between two clubs (with goal events + scores). */
export async function headToHead(teamA, teamB) {
  return fetchAll(`/v3/football/fixtures/head-to-head/${teamA}/${teamB}`, {
    include: "participants;scores;events;league",
  });
}

// ── Players ──────────────────────────────────────────────────────────────────

/** Full player dossier: career clubs, transfers, per-season statistics. */
export async function player(playerId) {
  const body = await smFetch(`/v3/football/players/${playerId}`, {
    include: "statistics.details.type;teams;transfers;nationality",
  });
  return body?.data ?? null;
}

export async function squad(teamId) {
  return fetchAll(`/v3/football/squads/teams/${teamId}`, { include: "player" });
}

export async function searchTeam(name) {
  const body = await smFetch(`/v3/football/teams/search/${encodeURIComponent(name)}`);
  return body?.data ?? [];
}

// ── Entitlements ─────────────────────────────────────────────────────────────

const REQUIRED = ["livescore", "lineup", "fixture", "statistic", "transfer", "state"];

/**
 * Assert the plan still covers what the pipeline needs. Called at the top of
 * gen-base/gen-fresh so a lapsed subscription (the trial ends 2026-07-22) fails
 * loudly on a quiet morning rather than silently at 14:00 on a Saturday.
 */
export async function assertEntitlements() {
  const body = await smFetch("/v3/my/resources");
  const blob = JSON.stringify(body?.data ?? []).toLowerCase();
  const missing = REQUIRED.filter((r) => !blob.includes(r));
  return { ok: missing.length === 0, missing };
}

// ── Shapes ───────────────────────────────────────────────────────────────────

export function participants(fx) {
  const parts = fx?.participants ?? [];
  const home = parts.find((p) => p.meta?.location === "home");
  const away = parts.find((p) => p.meta?.location === "away");
  return home && away ? { home, away } : null;
}

export function starters(fx, teamId) {
  return (fx?.lineups ?? []).filter(
    (l) => l.type_id === LINEUP_TYPE.STARTER && (teamId === undefined || l.team_id === teamId),
  );
}

export function bench(fx, teamId) {
  return (fx?.lineups ?? []).filter(
    (l) => l.type_id === LINEUP_TYPE.BENCH && (teamId === undefined || l.team_id === teamId),
  );
}

export function formationOf(fx, teamId) {
  return (fx?.formations ?? []).find((f) => f.participant_id === teamId)?.formation ?? null;
}

/**
 * Lineups are CONFIRMED when both sides have a full XI. Anything less is a
 * provisional/partial sheet and the fresh slice must not be built from it.
 */
export function lineupsConfirmed(fx, homeId, awayId) {
  return starters(fx, homeId).length >= 11 && starters(fx, awayId).length >= 11;
}

/** Final score of a completed fixture, from the CURRENT score rows. */
export function finalScore(fx) {
  const rows = (fx?.scores ?? []).filter((s) => s.description === "CURRENT");
  const home = rows.find((s) => s.score?.participant === "home")?.score?.goals;
  const away = rows.find((s) => s.score?.participant === "away")?.score?.goals;
  if (typeof home !== "number" || typeof away !== "number") return null;
  return { home, away };
}

/** Sum a stat across a player's statistics rows, optionally scoped to a club. */
export function statTotal(playerRow, statId, { teamId, seasonId, excludeSeasonId } = {}) {
  let total = 0;
  let found = false;
  for (const s of playerRow?.statistics ?? []) {
    if (teamId !== undefined && s.team_id !== teamId) continue;
    if (seasonId !== undefined && s.season_id !== seasonId) continue;
    if (excludeSeasonId !== undefined && s.season_id === excludeSeasonId) continue;
    if (s.has_values === false) continue;
    for (const d of s.details ?? []) {
      if (d.type_id !== statId) continue;
      const v = d.value?.total;
      if (typeof v === "number") {
        total += v;
        found = true;
      }
    }
  }
  return found ? total : null;
}

/** Every club id the player has ever been contracted to (teams[] + transfers[]). */
export function careerClubIds(playerRow) {
  const ids = new Set();
  for (const t of playerRow?.teams ?? []) if (t.team_id) ids.add(Number(t.team_id));
  for (const t of playerRow?.transfers ?? []) {
    if (t.from_team_id) ids.add(Number(t.from_team_id));
    if (t.to_team_id) ids.add(Number(t.to_team_id));
  }
  return ids;
}

export function displayName(playerRow) {
  return playerRow?.display_name || playerRow?.name || playerRow?.common_name || "";
}
