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

/** One gameweek's fixtures → for each SM player, ONE MatchFacts PER match they
 *  appeared in (a single-game week is a one-element list). Kept per-match, not
 *  pre-summed, so a DOUBLE GAMEWEEK can be scored per fixture and added like FPL:
 *  the appearance point, clean sheets and defensive contribution then count for
 *  EACH game, rather than once on the combined totals. Clean sheet requires 60+
 *  min and zero conceded in that match. */
export function aggregateFixtures(fixtures: SmFixture[]): Map<number, MatchFacts[]> {
  const out = new Map<number, MatchFacts[]>();
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
      // A fresh facts object for THIS fixture — one entry per match played.
      const f: MatchFacts = { ...ZERO_FACTS };
      f.minutes = mins;
      f.goals = statVal(det, /^Goals$/i);
      f.assists = statVal(det, /^Assists$/i);
      f.yellows = statVal(det, /^Yellowcards$|^Yellow Cards$/i);
      f.reds = statVal(det, /^Redcards$|^Red Cards$|^Yellowred Cards$/i);
      f.saves = statVal(det, /^Saves$/i);
      f.pensSaved = statVal(det, /^Penalties Saved$/i);
      f.pensMissed = statVal(det, /^Penalties Missed$/i);
      f.ownGoals = statVal(det, /^Own Goals$/i);
      const conceded = statVal(det, /^Goals Conceded$|^Goalkeeper Goals Conceded$/i);
      f.conceded = conceded;
      if (mins >= 60 && conceded === 0 && teamConceded(l.team_id) === 0) f.cleanSheet = 1;
      const cbit = statVal(det, /^Clearances$/i) + statVal(det, /^Interceptions$/i) +
        statVal(det, /^Tackles$/i) + statVal(det, /^Shots Blocked$|^Blocked Shots$/i);
      f.dc = cbit;
      f.dcRec = cbit + statVal(det, /^Ball Recovery$/i);
      const list = out.get(l.player_id) ?? [];
      list.push(f);
      out.set(l.player_id, list);
    }
  }
  return out;
}

/** Sum per-match facts into one for DISPLAY (the breakdown card + the minutes an
 *  auto-sub reads). Points are NOT derived from this — they're the sum of each
 *  match scored on its own (see toPlayerScores). */
function mergeFacts(list: MatchFacts[]): MatchFacts {
  const m: MatchFacts = { ...ZERO_FACTS };
  for (const f of list) {
    m.minutes += f.minutes; m.goals += f.goals; m.assists += f.assists;
    m.cleanSheet += f.cleanSheet; m.conceded += f.conceded; m.saves += f.saves;
    m.pensSaved += f.pensSaved; m.pensMissed += f.pensMissed;
    m.yellows += f.yellows; m.reds += f.reds; m.ownGoals += f.ownGoals;
    m.dc += f.dc; m.dcRec += f.dcRec;
  }
  return m;
}

/** Map SM facts onto pool players via baked smId and score them. Points are the
 *  sum of EACH match scored separately (FPL-style doubles); a single-game week is
 *  one match, so it's unchanged. `facts` is the merged total, for display. */
export function toPlayerScores(byPlayer: Map<number, MatchFacts[]>, pool: PoolEntry[]): {
  scores: GwPlayerScore[]; matched: number; unmatchedSmIds: number[];
} {
  const bySmId = new Map(pool.map((p) => [p.smId, p]));
  const scores: GwPlayerScore[] = [];
  const unmatchedSmIds: number[] = [];
  byPlayer.forEach((list, smId) => {
    const p = bySmId.get(smId);
    if (!p) { unmatchedSmIds.push(smId); return; }
    const points = list.reduce((sum, f) => sum + pointsFor(p.pos, f), 0);
    scores.push({ playerId: p.id, smId, points, facts: mergeFacts(list) });
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
      // `events` carries timed goals/assists (minute + scorer + assist) for the
      // live ticker; it does not affect scoring, which reads the stat totals.
      `https://api.sportmonks.com/v3/football/fixtures/${f.id}?include=lineups.details.type;participants;scores;events&api_token=${apiKey}`,
    );
    if (!res.ok) throw new Error(`SM fixture ${f.id} ${res.status}`);
    out.push(((await res.json()) as { data: SmFixture }).data);
  }
  return out;
}
