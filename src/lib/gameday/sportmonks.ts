import "server-only";

/**
 * Thin SportMonks v3 client for the Gameday content validator.
 *
 * Historical/H2H data ONLY — the base-question pipeline's grounding source
 * (docs/gameday-quiz-spec.md §3.2: H2H record, classic meetings, club records,
 * stadium/derby history). This is a SEPARATE client from
 * src/lib/halftime/sportmonks.ts on purpose: that one serves live phases and
 * final scores for the prediction poll and must not grow a historical-data
 * surface it doesn't need, and this one has no reason to know about live
 * match state at all — a Gameday pack is written and frozen two days before
 * kickoff, so nothing here ever needs "now".
 *
 * Same seam as the sibling client: every call goes through SPORTMONKS_BASE_URL
 * (defaults to the real API), so a future replay/off-season harness can point
 * this at a fixture server too.
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

/** GET a SportMonks path. Bounded retries on 5xx/429/network error; 4xx other
 * than 429 is a caller bug and fails fast, no retry. */
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

// ── Head-to-head ─────────────────────────────────────────────────────────────

export interface SmH2HFixture {
  id: number;
  starting_at?: string | null;
  state_id?: number;
  name?: string;
  participants?: Array<{ id: number; name: string; meta?: { location?: "home" | "away" } }>;
  scores?: Array<{ description?: string; score?: { goals?: number; participant?: string } | null }>;
}

/**
 * Every historical meeting between two teams — the H2H record and classic
 * meetings §3.2 asks for. `starting_at < before` when supplied, so a question
 * about "the record going into this fixture" can never be resolved against a
 * meeting that has not happened yet (relevant only for a mid-season re-run of
 * a fixture already generated once this season).
 */
export async function getH2HFixtures(
  teamAId: number,
  teamBId: number,
  opts: { before?: string } = {},
): Promise<SmH2HFixture[]> {
  const rows = await smFetch<SmH2HFixture[]>(`/v3/football/fixtures/head-to-head/${teamAId}/${teamBId}`, {
    include: "participants;scores",
  });
  if (!opts.before) return rows ?? [];
  const cutoff = new Date(opts.before).getTime();
  return (rows ?? []).filter((f) => {
    const at = f.starting_at ? new Date(f.starting_at).getTime() : NaN;
    return Number.isFinite(at) && at < cutoff;
  });
}

// ── Season aggregates ────────────────────────────────────────────────────────

export interface SmSeasonAggregate {
  teamId: number;
  seasonId: number;
  played: number;
  won: number;
  draw: number;
  lost: number;
}

/** Historical Data — a team's aggregate record for a past season (club records,
 * §3.2). Empty for a season that has not been played. */
export async function getSeasonAggregate(teamId: number, seasonId: number): Promise<SmSeasonAggregate | null> {
  const rows = await smFetch<
    Array<{ team_id?: number; season_id?: number; matches?: number; wins?: number; draws?: number; losses?: number }>
  >(`/v3/football/statistics/seasons/teams/${seasonId}`, { filters: `teamStatisticSeasons:${teamId}` });
  const row = (rows ?? [])[0];
  if (!row) return null;
  return {
    teamId,
    seasonId,
    played: Number(row.matches ?? 0),
    won: Number(row.wins ?? 0),
    draw: Number(row.draws ?? 0),
    lost: Number(row.losses ?? 0),
  };
}

// ── Schedule (postponement check) ────────────────────────────────────────────

export interface SmScheduledFixture {
  id: number;
  state_id?: number;
}

/**
 * Fixture ids SportMonks still lists as scheduled PL fixtures on a given date
 * (YYYY-MM-DD). Used by the publish cron's postponement check (§4.1 step 4):
 * a tracked fixture no longer appearing here has been postponed/rescheduled
 * off that day.
 */
export async function getScheduledFixtureIds(date: string): Promise<Set<number>> {
  const rows = await smFetch<SmScheduledFixture[]>(`/v3/football/fixtures/date/${date}`, {
    filters: `fixtureLeagues:${PL_LEAGUE_ID}`,
  });
  return new Set((rows ?? []).map((r) => Number(r.id)));
}

// ── Entitlements ─────────────────────────────────────────────────────────────

const REQUIRED_RESOURCES = ["historical", "fixtures"];

/** Does the paid plan cover what the base-question validator needs? */
export async function assertHistoricalEntitlements(): Promise<{ ok: boolean; missing: string[] }> {
  const raw = await smFetch<unknown>("/v3/my/resources");
  const blob = JSON.stringify(raw ?? []).toLowerCase();
  const missing = REQUIRED_RESOURCES.filter((r) => !blob.includes(r));
  return { ok: missing.length === 0, missing };
}
