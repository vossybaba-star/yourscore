/**
 * SportMonks source adapter — enriches the FPL-normalized Player[] with the
 * fields the Who-am-I format needs: nationality, age and jersey number.
 *
 * Design notes:
 * - The MATCHING logic is pure (testable); the fetchers are separate helpers.
 * - Matching is deliberately conservative — name+club only, and only when the
 *   candidate is unambiguous on BOTH sides. An unmatched player simply stays
 *   unenriched (still fine for Higher/Lower + form; excluded as a Who-am-I
 *   answer). Precision over coverage: a wrong enrichment makes a WRONG question,
 *   a missing one just makes fewer. (Same lesson as the WC nationality build:
 *   never add a name-only fallback.)
 * - Career history is NOT sourced here: the Starter plan omits out-of-plan
 *   leagues, so histories are partial (verified live: Haaland → Man City only).
 *   Career-path builds from the owned FIFA dataset instead.
 */

import type { Player } from "./types";

/** One squad member as we normalize it off the SportMonks squad endpoint. */
export interface SmPlayer {
  smId: number;
  name: string; // display_name
  clubId: number; // SportMonks team id
  club: string; // team name, e.g. "Manchester City"
  jersey?: number;
  dateOfBirth?: string; // "YYYY-MM-DD"
  nationality?: string;
  imagePath?: string; // player headshot URL
  flagPath?: string; // nationality flag URL
}

/** Enrichment fields we copy onto a matched Player. */
export interface Enrichment {
  nationality?: string;
  age?: number;
  jersey?: number;
  photoUrl?: string;
  flagUrl?: string;
  /** The matched SportMonks player id — the FPL↔SM identity bridge. */
  smId?: number;
}

/** Lowercase, strip diacritics, collapse whitespace. */
export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Last name token (the strongest cross-source signal for footballer names). */
export function lastToken(s: string): string {
  const t = normalizeName(s).split(" ");
  return t[t.length - 1] ?? "";
}

/** Age in whole years at `now` from an ISO date-of-birth. */
export function ageFrom(dob: string, now: Date): number | undefined {
  const d = new Date(dob + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return undefined;
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age--;
  return age >= 14 && age <= 50 ? age : undefined;
}

/** FPL club-name abbreviations expanded before matching (data normalization —
 *  a fixed, checkable list, NOT fuzzy guessing). */
const CLUB_ALIASES: Record<string, string> = {
  spurs: "tottenham hotspur",
  utd: "united",
  "nott'm": "nottingham",
  wolves: "wolverhampton wanderers",
};

function expandAliases(name: string): string {
  return name
    .toLowerCase()
    .split(/\s+/)
    .map((t) => CLUB_ALIASES[t] ?? t)
    .join(" ");
}

/** Token prefix-overlap score between two normalized names ("man" ⊂ "manchester"). */
function prefixScore(a: string, b: string): number {
  const at = a.split(" ").filter((t) => t.length >= 3);
  const bt = b.split(" ").filter((t) => t.length >= 3);
  let n = 0;
  for (const x of at) if (bt.some((y) => y.startsWith(x) || x.startsWith(y))) n++;
  return n;
}

/**
 * Map FPL club ids to SportMonks club ids. FPL names are abbreviated ("Man
 * City", "Spurs"); we expand known aliases, then require a UNIQUE best match
 * with a prefix-overlap score ≥ 2 — otherwise the club stays unmapped (its
 * players simply aren't enriched; never a wrong club).
 */
export function matchClubs(
  fplClubs: readonly { id: number; name: string }[],
  smClubs: readonly { id: number; name: string }[],
): Map<number, number> {
  const out = new Map<number, number>();
  for (const f of fplClubs) {
    const fn = normalizeName(expandAliases(f.name));
    const fnTokens = fn.split(" ").filter((t) => t.length >= 3).length;
    let best: { id: number; score: number } | null = null;
    let tie = false;
    for (const s of smClubs) {
      const score = prefixScore(fn, normalizeName(expandAliases(s.name)));
      if (best === null || score > best.score) {
        best = { id: s.id, score };
        tie = false;
      } else if (score === best.score) tie = true;
    }
    // Accept a unique best when it matches ≥2 tokens, OR when it covers EVERY
    // token of the FPL name (handles one-word clubs: Arsenal, Liverpool, …).
    if (best && !tie && (best.score >= 2 || (best.score >= 1 && best.score >= fnTokens)))
      out.set(f.id, best.id);
  }
  return out;
}

/**
 * Conservatively match FPL players to SportMonks squad members and return the
 * enrichment per FPL player id. Rule: same (mapped) club AND same last-name
 * token AND exactly one candidate on each side — otherwise no match.
 */
export function buildEnrichment(
  players: readonly Player[],
  smPlayers: readonly SmPlayer[],
  clubMap: Map<number, number>, // fpl clubId -> sm clubId
  now: Date,
): Map<number, Enrichment> {
  // Index SM players by (smClubId, lastToken)
  const smIndex = new Map<string, SmPlayer[]>();
  for (const s of smPlayers) {
    const key = `${s.clubId}:${lastToken(s.name)}`;
    const arr = smIndex.get(key);
    if (arr) arr.push(s);
    else smIndex.set(key, [s]);
  }
  // Count FPL players per (fplClubId, lastToken) to enforce uniqueness on our side too
  const fplCount = new Map<string, number>();
  for (const p of players) {
    const key = `${p.clubId}:${lastToken(p.name)}`;
    fplCount.set(key, (fplCount.get(key) ?? 0) + 1);
  }

  const out = new Map<number, Enrichment>();
  for (const p of players) {
    const smClub = clubMap.get(p.clubId);
    if (smClub === undefined) continue;
    const token = lastToken(p.name);
    if (!token) continue;
    if ((fplCount.get(`${p.clubId}:${token}`) ?? 0) !== 1) continue; // ambiguous on FPL side
    const candidates = smIndex.get(`${smClub}:${token}`) ?? [];
    if (candidates.length !== 1) continue; // ambiguous or missing on SM side
    const s = candidates[0];
    out.set(p.id, {
      nationality: s.nationality,
      age: s.dateOfBirth ? ageFrom(s.dateOfBirth, now) : undefined,
      jersey: s.jersey,
      photoUrl: s.imagePath,
      flagUrl: s.flagPath,
      smId: s.smId,
    });
  }
  return out;
}

/** Apply an enrichment map to players (returns new objects; input untouched). */
export function enrichPlayers(
  players: readonly Player[],
  enrichment: Map<number, Enrichment>,
): Player[] {
  return players.map((p) => {
    const e = enrichment.get(p.id);
    return e
      ? { ...p, nationality: e.nationality, age: e.age, jersey: e.jersey, photoUrl: e.photoUrl, flagUrl: e.flagUrl }
      : p;
  });
}

// ---------------------------------------------------------------------------
// Fetchers (network — used by scripts/serving, not by tests)
// ---------------------------------------------------------------------------

const SM_BASE = "https://api.sportmonks.com/v3/football";

async function smGet(path: string, key: string): Promise<unknown> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${SM_BASE}${path}${sep}api_token=${key}`);
  if (!res.ok) throw new Error(`SportMonks ${path} ${res.status}`);
  const body = (await res.json()) as { data?: unknown; message?: string };
  if (body.data === undefined) throw new Error(`SportMonks ${path}: ${body.message ?? "no data"}`);
  return body.data;
}

/** Teams in a season: [{id, name}]. */
export async function fetchSmSeasonTeams(
  seasonId: number,
  key: string,
): Promise<{ id: number; name: string }[]> {
  const data = (await smGet(`/teams/seasons/${seasonId}`, key)) as {
    id: number;
    name: string;
  }[];
  return data.map((t) => ({ id: t.id, name: t.name }));
}

/** A team's squad for a season, with player nationality included. */
export async function fetchSmSquad(
  seasonId: number,
  teamId: number,
  teamName: string,
  key: string,
): Promise<SmPlayer[]> {
  const data = (await smGet(
    `/squads/seasons/${seasonId}/teams/${teamId}?include=player.nationality`,
    key,
  )) as {
    jersey_number?: number;
    player?: {
      id: number;
      display_name?: string;
      name?: string;
      date_of_birth?: string;
      image_path?: string;
      nationality?: { name?: string; image_path?: string };
    };
  }[];
  const out: SmPlayer[] = [];
  for (const row of data) {
    const pl = row.player;
    if (!pl) continue;
    const name = pl.display_name ?? pl.name;
    if (!name) continue;
    out.push({
      smId: pl.id,
      name,
      clubId: teamId,
      club: teamName,
      // API sends null for unassigned shirt numbers — coerce to undefined so
      // downstream "known attribute" checks stay honest.
      jersey: typeof row.jersey_number === "number" ? row.jersey_number : undefined,
      dateOfBirth: pl.date_of_birth ?? undefined,
      nationality: pl.nationality?.name ?? undefined,
      imagePath: pl.image_path ?? undefined,
      flagPath: pl.nationality?.image_path ?? undefined,
    });
  }
  return out;
}

/** All squads for a season (sequential — ~20 requests, well under rate limits). */
export async function fetchSmSeasonSquads(
  seasonId: number,
  key: string,
): Promise<{ teams: { id: number; name: string }[]; players: SmPlayer[] }> {
  const teams = await fetchSmSeasonTeams(seasonId, key);
  const players: SmPlayer[] = [];
  for (const t of teams) {
    players.push(...(await fetchSmSquad(seasonId, t.id, t.name, key)));
  }
  return { teams, players };
}
