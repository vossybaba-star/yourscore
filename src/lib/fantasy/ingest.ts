/**
 * Gameweek ingest — SportMonks fixtures → per-player MatchFacts → YourScore
 * points. Productionizes the proven spike (scripts/fantasy/ingest-spike.mjs,
 * Spearman 0.980 vs FPL actual): same stat-name mapping, but identity flows
 * through the pool's BAKED smId — no name matching ever happens here.
 *
 * `aggregateFixtures` is pure (testable on cached fixture JSON); the fetcher is
 * a thin separate helper.
 */

import { type FantasyPos, type MatchFacts, ZERO_FACTS, pointsFor } from "./values";

export interface PoolEntry { id: number; smId: number; pos: FantasyPos; name: string }
export interface GwPlayerScore { playerId: number; smId: number; points: number; facts: MatchFacts }

interface SmDetail { type?: { name?: string }; data?: { value?: unknown } }
interface SmLineup { player_id: number; player_name?: string; team_id: number; details?: SmDetail[] }
interface SmScore { description?: string; participant_id?: number; score?: { goals?: number; participant_id?: number } }
export interface SmFixture {
  id: number;
  participants?: { id: number; name?: string }[];
  scores?: SmScore[];
  lineups?: SmLineup[];
}

const statVal = (details: SmDetail[], re: RegExp): number => {
  const d = details.find((x) => re.test(x.type?.name ?? ""));
  const v = d?.data?.value;
  return typeof v === "number" ? v : v === true ? 1 : 0;
};

/** Aggregate one gameweek's fixtures into per-SM-player match facts.
 *  Doubles simply sum; clean sheet requires 60+ min and zero conceded. */
export function aggregateFixtures(fixtures: SmFixture[]): Map<number, MatchFacts> {
  const out = new Map<number, MatchFacts>();
  for (const fx of fixtures) {
    const teamIds = (fx.participants ?? []).map((p) => p.id);
    const goalsFor = new Map<number, number>();
    for (const s of fx.scores ?? [])
      if (s.description === "CURRENT")
        goalsFor.set(s.participant_id ?? s.score?.participant_id ?? -1, s.score?.goals ?? 0);
    const teamConceded = (tid: number) => {
      const other = teamIds.find((x) => x !== tid);
      return other !== undefined ? goalsFor.get(other) ?? 0 : 0;
    };
    for (const l of fx.lineups ?? []) {
      const det = l.details ?? [];
      const mins = statVal(det, /^Minutes Played$/i);
      if (!mins) continue;
      const cur = out.get(l.player_id) ?? { ...ZERO_FACTS };
      cur.minutes += mins;
      cur.goals += statVal(det, /^Goals$/i);
      cur.assists += statVal(det, /^Assists$/i);
      cur.yellows += statVal(det, /^Yellowcards$|^Yellow Cards$/i);
      cur.reds += statVal(det, /^Redcards$|^Red Cards$|^Yellowred Cards$/i);
      cur.saves += statVal(det, /^Saves$/i);
      cur.pensSaved += statVal(det, /^Penalties Saved$/i);
      cur.pensMissed += statVal(det, /^Penalties Missed$/i);
      cur.ownGoals += statVal(det, /^Own Goals$/i);
      const conceded = statVal(det, /^Goals Conceded$|^Goalkeeper Goals Conceded$/i);
      cur.conceded += conceded;
      if (mins >= 60 && conceded === 0 && teamConceded(l.team_id) === 0) cur.cleanSheet = 1;
      const cbit = statVal(det, /^Clearances$/i) + statVal(det, /^Interceptions$/i) +
        statVal(det, /^Tackles$/i) + statVal(det, /^Shots Blocked$|^Blocked Shots$/i);
      cur.dc += cbit;
      cur.dcRec += cbit + statVal(det, /^Ball Recovery$/i);
      out.set(l.player_id, cur);
    }
  }
  return out;
}

/** Map SM facts onto pool players via baked smId and score them. */
export function toPlayerScores(facts: Map<number, MatchFacts>, pool: PoolEntry[]): {
  scores: GwPlayerScore[]; matched: number; unmatchedSmIds: number[];
} {
  const bySmId = new Map(pool.map((p) => [p.smId, p]));
  const scores: GwPlayerScore[] = [];
  const unmatchedSmIds: number[] = [];
  facts.forEach((f, smId) => {
    const p = bySmId.get(smId);
    if (!p) { unmatchedSmIds.push(smId); return; }
    scores.push({ playerId: p.id, smId, points: pointsFor(p.pos, f), facts: f });
  });
  return { scores, matched: scores.length, unmatchedSmIds };
}

/** Fetch a gameweek's fixtures (with lineup stat details) from SportMonks. */
export async function fetchGwFixtures(
  smSeasonId: number, from: string, to: string, apiKey: string,
): Promise<SmFixture[]> {
  const listRes = await fetch(
    `https://api.sportmonks.com/v3/football/fixtures/between/${from}/${to}?filters=fixtureLeagues:8&per_page=15&api_token=${apiKey}`,
  );
  if (!listRes.ok) throw new Error(`SM fixtures list ${listRes.status}`);
  const list = ((await listRes.json()) as { data?: { id: number }[] }).data ?? [];
  const out: SmFixture[] = [];
  for (const f of list) {
    const res = await fetch(
      `https://api.sportmonks.com/v3/football/fixtures/${f.id}?include=lineups.details.type;participants;scores&api_token=${apiKey}`,
    );
    if (!res.ok) throw new Error(`SM fixture ${f.id} ${res.status}`);
    out.push(((await res.json()) as { data: SmFixture }).data);
  }
  return out;
}
