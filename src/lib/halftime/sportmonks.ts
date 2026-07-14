import "server-only";
import { classifyPhase, type MatchPhase } from "@/lib/halftime/shared";

/**
 * Thin SportMonks v3 client for the halftime pipeline.
 *
 * THE SEAM: every call goes through SPORTMONKS_BASE_URL. It defaults to the
 * real API, and the off-season replay harness (scripts/halftime/replay-server.mjs)
 * points it at localhost so the poller and watchdog run UNMODIFIED against a
 * recorded matchday. This env var is the only reason this indirection exists —
 * do not inline the base URL anywhere.
 *
 * Entitlements (verified 2026-07-14 via GET /v3/my/resources on the trial key):
 * livescores, inplay, states, periods, lineups, fixtures, Historical Data.
 * NOTE: the trial expires 2026-07-22. assertEntitlements() is the runtime guard
 * — the poller calls it at startup so a lapsed plan fails loudly, not silently.
 *
 * No webhooks exist (the endpoint 404s), so polling is the only option.
 * Observed rate limit: 2000/hr/entity.
 */

export const SPORTMONKS_BASE_URL =
  process.env.SPORTMONKS_BASE_URL || "https://api.sportmonks.com";

/** Premier League. */
export const PL_LEAGUE_ID = 8;

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 400;

export class SportmonksError extends Error {
  readonly status: number;
  readonly rateLimited: boolean;
  constructor(message: string, status: number) {
    super(message);
    this.name = "SportmonksError";
    this.status = status;
    this.rateLimited = status === 429;
  }
}

interface SmEnvelope<T> {
  data?: T;
  message?: string;
}

function apiToken(): string {
  const token = process.env.SPORTMONKS_API_KEY;
  if (!token) throw new SportmonksError("SPORTMONKS_API_KEY is not set", 0);
  return token;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * GET a SportMonks path. Bounded retries (LOOP rule 3): 3 attempts with
 * exponential backoff on 5xx / 429 / network error, then throw. 4xx other than
 * 429 is a caller bug — fail fast, no retry.
 *
 * The token goes in the Authorization header, never the query string, so it
 * cannot leak into logs or an error message.
 */
async function smFetch<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
): Promise<T> {
  const url = new URL(path.replace(/^\//, ""), `${SPORTMONKS_BASE_URL.replace(/\/$/, "")}/`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }

  let lastErr: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url.toString(), {
        headers: { Authorization: apiToken(), Accept: "application/json" },
        cache: "no-store",
      });

      if (res.ok) {
        const body = (await res.json()) as SmEnvelope<T>;
        return (body.data ?? []) as T;
      }

      // Client errors (except rate limiting) are not worth retrying.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        throw new SportmonksError(`SportMonks ${res.status} on ${path}`, res.status);
      }
      lastErr = new SportmonksError(`SportMonks ${res.status} on ${path}`, res.status);
    } catch (err) {
      if (err instanceof SportmonksError && !err.rateLimited && err.status >= 400 && err.status < 500) {
        throw err;
      }
      lastErr = err instanceof Error ? err : new Error(String(err));
    }

    if (attempt < MAX_ATTEMPTS) await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
  }

  throw lastErr ?? new SportmonksError(`SportMonks request failed: ${path}`, 0);
}

// ── States catalogue ─────────────────────────────────────────────────────────

export interface SmState {
  id: number;
  state: string;
  name: string;
  developer_name: string;
  short_name: string | null;
}

// States effectively never change. Cache per serverless instance so the
// watchdog spends one call on the catalogue at most once every 6 hours.
let statesCache: { at: number; byId: Map<number, SmState> } | null = null;
const STATES_TTL_MS = 6 * 60 * 60 * 1000;

export async function getStates(): Promise<Map<number, SmState>> {
  if (statesCache && Date.now() - statesCache.at < STATES_TTL_MS) {
    return statesCache.byId;
  }
  const rows = await smFetch<SmState[]>("/v3/football/states");
  const byId = new Map<number, SmState>();
  for (const s of rows ?? []) byId.set(Number(s.id), s);
  statesCache = { at: Date.now(), byId };
  return byId;
}

/** Test seam: drop the cached states catalogue. */
export function __resetStatesCache(): void {
  statesCache = null;
}

// ── Livescores ───────────────────────────────────────────────────────────────

export interface SmLiveFixture {
  id: number;
  name?: string;
  state_id: number;
  starting_at?: string | null;
  league_id?: number;
}

/**
 * ONE call covers every in-play fixture — this is why a 6s poll of a 10-fixture
 * Saturday slate still sits comfortably inside the 2000/hr limit.
 */
export async function getLivescores(): Promise<SmLiveFixture[]> {
  const rows = await smFetch<SmLiveFixture[]>("/v3/football/livescores/latest");
  return rows ?? [];
}

/**
 * fixture_id → current match phase, resolved through the states catalogue.
 * Only the halftime id (3) is hardcoded anywhere; every other state is matched
 * by developer_name, so a SportMonks id renumbering cannot make us release a
 * pack in the 78th minute.
 *
 * FOR THE 6s POLLER ONLY. /livescores/latest returns fixtures that received an
 * update in the last ~10 seconds, which is exactly right at a 6s cadence and
 * exactly wrong at any slower one — see getPhasesForFixtures().
 */
export async function getLivePhases(): Promise<Map<number, MatchPhase>> {
  const [fixtures, states] = await Promise.all([getLivescores(), getStates()]);
  const out = new Map<number, MatchPhase>();
  for (const f of fixtures) {
    const stateId = Number(f.state_id);
    out.set(Number(f.id), classifyPhase(stateId, states.get(stateId)?.developer_name));
  }
  return out;
}

/**
 * Current phase for a KNOWN set of fixtures — one call, by id.
 *
 * This is what the 5-minute watchdog must use. /livescores/latest is a
 * recently-updated feed, not a "what is the state of these matches" query: a
 * fixture only appears there if it changed in the last ~10 seconds, and it
 * drops off the feed entirely once the match ends. A watchdog polling that feed
 * every 5 minutes would usually see nothing, and a fixture whose half-time it
 * missed would have vanished by the time it looked — so it could never issue
 * the `released_late` catch-up that is the watchdog's whole reason to exist.
 *
 * Querying the fixtures by id returns their state whether they are in play,
 * finished, or postponed. That is the property a backstop needs.
 */
export async function getPhasesForFixtures(
  fixtureIds: number[],
): Promise<Map<number, MatchPhase>> {
  const out = new Map<number, MatchPhase>();
  if (!fixtureIds.length) return out; // no call at all — the idle path stays free

  const [fixtures, states] = await Promise.all([
    smFetch<SmFixture[]>(`/v3/football/fixtures/multi/${fixtureIds.join(",")}`),
    getStates(),
  ]);

  for (const f of fixtures ?? []) {
    const stateId = Number(f.state_id);
    if (!Number.isFinite(stateId)) continue;
    out.set(Number(f.id), classifyPhase(stateId, states.get(stateId)?.developer_name));
  }
  return out;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

export interface SmParticipant {
  id: number;
  name: string;
  meta?: { location?: "home" | "away" };
}

export interface SmFixture {
  id: number;
  name?: string;
  starting_at?: string | null;
  state_id?: number;
  season_id?: number | null;
  league_id?: number;
  round?: { id: number; name: string } | null;
  participants?: SmParticipant[];
}

export async function getFixture(
  fixtureId: number,
  includes = "participants",
): Promise<SmFixture | null> {
  const row = await smFetch<SmFixture>(`/v3/football/fixtures/${fixtureId}`, {
    include: includes,
  });
  return row && (row as SmFixture).id ? row : null;
}

/** PL fixtures in a date window — the weekly season sync (W3) reads this. */
export async function getFixturesBetween(
  from: string,
  to: string,
  leagueId: number = PL_LEAGUE_ID,
): Promise<SmFixture[]> {
  const rows = await smFetch<SmFixture[]>(`/v3/football/fixtures/between/${from}/${to}`, {
    filters: `fixtureLeagues:${leagueId}`,
    include: "participants;round",
  });
  return rows ?? [];
}

/** Home/away names from a fixture's participants (falls back to the "A vs B" name). */
export function participantNames(fixture: SmFixture): { home: string; away: string } | null {
  const parts = fixture.participants ?? [];
  const home = parts.find((p) => p.meta?.location === "home")?.name;
  const away = parts.find((p) => p.meta?.location === "away")?.name;
  if (home && away) return { home, away };

  const bits = String(fixture.name ?? "").split(/\s+vs?\.?\s+/i);
  if (bits.length === 2) return { home: bits[0].trim(), away: bits[1].trim() };
  return null;
}

// ── Entitlements ─────────────────────────────────────────────────────────────

const REQUIRED_RESOURCES = ["livescores", "states", "lineups", "fixtures"];

/**
 * Assert the plan still covers what the pipeline needs. The poller calls this
 * at startup so a lapsed subscription (the trial ends 2026-07-22) fails loudly
 * on a quiet morning instead of silently at 15:47 on a Saturday.
 */
export async function assertEntitlements(): Promise<{ ok: boolean; missing: string[] }> {
  const raw = await smFetch<unknown>("/v3/my/resources");
  const blob = JSON.stringify(raw ?? []).toLowerCase();
  const missing = REQUIRED_RESOURCES.filter((r) => !blob.includes(r));
  return { ok: missing.length === 0, missing };
}
