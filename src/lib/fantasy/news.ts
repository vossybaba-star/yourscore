/**
 * Fantasy news & insights hub — feed builder (docs/fantasy-news-hub-spec.md).
 *
 * One GENERAL feed doc per gameweek, built by /api/cron/fantasy-news and read
 * by /fantasy/news. Design mirrors ingest.ts: the section builders are pure
 * (testable on cached JSON); the SportMonks fetchers are thin separate helpers.
 *
 * Section sources (deliberate — see spec §4):
 * - fixtures:  SportMonks fixtures + standings (difficulty = position bands)
 * - teamNews:  SportMonks predicted XIs, diffed vs the previous snapshot for
 *              "likely doubt" flags (we have NO injuries endpoint), plus
 *              verified editorial/tweet items from fantasy_news_items
 * - form:      fantasy_player_scores ONLY — zero SportMonks calls; these are
 *              literally the numbers the game scores with
 * - transfers: fantasy_news_items (editorial river) — SM confirmed transfers
 *              can anchor this later
 * - tips:      authored per GW; preserved verbatim across rebuilds
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MatchFacts } from "./values";
import { fantasyPool } from "./pool";
import { generateTips } from "./tips";

// ---------------------------------------------------------------- doc shape

export type Difficulty = "kind" | "medium" | "tough";

/** One club's fixture in one gameweek, from THAT CLUB's perspective.
 *  A match-list ("BUR v BOU — tough") can't say who it's tough FOR; a fantasy
 *  ticker is always read down a club's own row, so difficulty is unambiguous. */
export interface NewsTickerCell {
  gw: number;
  opponent: string;
  oppShort: string;
  home: boolean;
  difficulty: Difficulty;
}

/** One club's run of upcoming fixtures — a row in the ticker. */
export interface NewsClubRun {
  clubId: number;
  club: string;
  short: string;
  /** Sparse: a GW with no fixture (blank GW) simply has no cell. */
  cells: NewsTickerCell[];
}

export interface NewsDoubt { smId: number; name: string; club: string; reason: string }
export interface NewsClubXI { club: string; clubId: number; xi: { smId: number; name: string }[] }

export interface NewsItem {
  kind: "article" | "tweet";
  /** article: {title,url,image?,source} · tweet: {text,author,handle,url,image?} */
  payload: Record<string, string>;
  createdAt: string;
}

export interface NewsFormRow { playerId: number; name: string; club: string; pos: string; line: string; points: number }

/** A card WE generate from our own data — form runs, fixture swings.
 *
 *  The feed is a stream of things you read, not a dashboard of tables. So our
 *  reference data (the form leaderboard, the ticker) becomes CONTENT: "Palmer's
 *  quietly on a run" rather than a row in a grid. Written in fan voice, easy on
 *  the stats — the numbers are there to back the point, not to be the point. */
export interface NewsInsight {
  kind: "form" | "fixture-swing";
  title: string;
  body: string;
}

export interface NewsTips {
  captain?: { player: string; why: string };
  differential?: { player: string; why: string };
  note?: string;
  /** ISO timestamp set when this draft was generated — rendered on the feed
   *  ("Drafted Tue 14:00") so staleness is honest even when a redraft attempt
   *  fails and the previous tips are left in place. */
  draftedAt?: string;
}

export interface NewsDoc {
  gw: number;
  deadline: string | null;
  builtAt: string;
  fixtures: { gws: number[]; runs: NewsClubRun[]; updatedAt: string };
  teamNews: { predicted: NewsClubXI[]; doubts: NewsDoubt[]; items: NewsItem[]; updatedAt: string };
  /** Kept as DATA (the ticker tab and the insight generator both read it), but
   *  never rendered as a table on the feed — see NewsInsight. */
  form: { rows: NewsFormRow[]; updatedAt: string };
  insights: { items: NewsInsight[]; updatedAt: string };
  transfers: { items: NewsItem[]; updatedAt: string };
  /** `gw` stamps which gameweek the tips were drafted for — that's the
   *  once-per-GW gate (hourly re-drafting would silently change advice under a
   *  user who read it this morning, and burn an LLM call each time), UNLESS a
   *  doubt now names the tipped captain/differential — see buildNewsDoc.
   *  `issue` carries the reason the LAST redraft attempt failed (if any), so a
   *  dead API key or a rejected draft is visible instead of silent. */
  tips: NewsTips & { gw?: number; updatedAt?: string; issue?: string };
}

// ------------------------------------------------------------ pure builders

/** Position-band difficulty: opponent in top 6 = tough, bottom 6 = kind. */
export function difficultyFor(opponentPosition: number | undefined, teamCount = 20): Difficulty {
  if (!opponentPosition) return "medium";
  if (opponentPosition <= 6) return "tough";
  if (opponentPosition > teamCount - 6) return "kind";
  return "medium";
}

interface SmParticipant {
  id: number;
  name?: string;
  /** SportMonks' own 3-letter club code (MCI, MUN, …) — verified present on
   *  participants. ALWAYS prefer it: a name-derived heuristic collapses
   *  Manchester City and Manchester United to the same "MAN" (it did). */
  short_code?: string;
  meta?: { location?: string };
}
export interface SmFixtureLite { id: number; starting_at?: string; participants?: SmParticipant[] }

/** GW window a fixture can be bucketed into (from fantasy_gameweeks). */
export interface GwWindow { gw: number; start: string; end: string }

/** Club code: SportMonks' short_code, with a name-derived fallback that keeps
 *  the distinguishing word (so "Manchester United" → MUN, not MAN). */
export function shortName(name: string, shortCode?: string): string {
  if (shortCode) return shortCode.toUpperCase();
  const words = name.replace(/[^A-Za-z\s]/g, " ").split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    // First two letters of the first word + first letter of the last —
    // "Manchester United" → MAU, "Manchester City" → MAC. Distinct, at least.
    return (words[0].slice(0, 2) + words[words.length - 1][0]).toUpperCase();
  }
  return (words[0] ?? name).slice(0, 3).toUpperCase();
}

/** Fixtures + standings + GW windows → one row per club, one cell per GW.
 *  Pure. Difficulty is always from the ROW CLUB's perspective. */
export function buildClubTicker(
  fixtures: SmFixtureLite[],
  positions: Map<number, number>,
  windows: GwWindow[],
): { gws: number[]; runs: NewsClubRun[] } {
  const gwOf = (kickoff: string): number | undefined => {
    const day = kickoff.slice(0, 10);
    return windows.find((w) => day >= w.start && day <= w.end)?.gw;
  };

  const byClub = new Map<number, NewsClubRun>();
  const row = (p: SmParticipant): NewsClubRun => {
    let r = byClub.get(p.id);
    if (!r) {
      const name = p.name ?? `#${p.id}`;
      r = { clubId: p.id, club: name, short: shortName(name, p.short_code), cells: [] };
      byClub.set(p.id, r);
    }
    return r;
  };
  const code = (p: SmParticipant) => shortName(p.name ?? `#${p.id}`, p.short_code);

  for (const f of fixtures) {
    const home = f.participants?.find((p) => p.meta?.location === "home");
    const away = f.participants?.find((p) => p.meta?.location === "away");
    if (!home || !away || !f.starting_at) continue;
    const gw = gwOf(f.starting_at);
    if (gw === undefined) continue; // outside the GW windows we're showing

    // Each club's difficulty is its OPPONENT's league strength.
    row(home).cells.push({
      gw, opponent: away.name ?? `#${away.id}`, oppShort: code(away), home: true,
      difficulty: difficultyFor(positions.get(away.id)),
    });
    row(away).cells.push({
      gw, opponent: home.name ?? `#${home.id}`, oppShort: code(home), home: false,
      difficulty: difficultyFor(positions.get(home.id)),
    });
  }

  const gws = windows.map((w) => w.gw);
  const runs: NewsClubRun[] = Array.from(byClub.values())
    .map((r): NewsClubRun => ({ ...r, cells: r.cells.sort((a, b) => a.gw - b.gw) }))
    .sort((a, b) => a.club.localeCompare(b.club));
  return { gws, runs };
}

/** Diff a club's CURRENT predicted XI against its per-GW BASELINE (the first
 *  snapshot stored for that club in that GW — see buildNewsDoc), not the most
 *  recent snapshot. Diffing against "latest" makes a doubt vanish after one
 *  cron cycle (run N flags the drop, run N+1 diffs against the snapshot that
 *  already lacks the player and finds nothing) even though the player is still
 *  out — this makes an absence a doubt for as long as it lasts. Pure. Only
 *  players in the fantasy pool are flagged (others are noise). */
export function diffPredictedXI(
  prev: NewsClubXI | undefined,
  curr: NewsClubXI,
  poolSmIds: Set<number>,
): NewsDoubt[] {
  if (!prev || prev.xi.length === 0 || curr.xi.length === 0) return [];
  const now = new Set(curr.xi.map((p) => p.smId));
  return prev.xi
    .filter((p) => !now.has(p.smId) && poolSmIds.has(p.smId))
    .map((p) => ({ smId: p.smId, name: p.name, club: curr.club, reason: "dropped from predicted XI" }));
}

/** Turn our own reference data into FEED CARDS. Pure.
 *
 *  The form table and the fixture ticker are tools, not content — a fan doesn't
 *  browse a leaderboard, they read "Palmer's on a run". So we say the thing the
 *  data implies, in fan voice, and let the number back it up rather than lead.
 *
 *  Two generators, deliberately conservative (a feed of weak takes is worse than
 *  a short feed):
 *  - form: only players who actually DID something (the formLine fallback is
 *    "steady minutes" — never worth a card).
 *  - fixture-swing: only a genuinely kind run (3+ kind games in the window). */
export function buildInsights(
  form: NewsFormRow[],
  runs: NewsClubRun[],
  maxForm = 3,
  maxSwings = 2,
): NewsInsight[] {
  const out: NewsInsight[] = [];

  // Lead with POINTS, not a stat line. Points are the game's own currency — the
  // number a manager actually cares about, and one we can never be wrong about
  // (it's literally what we scored them). A stat line alone overclaims: "1 goal
  // in his last 5" is not "a run", and a card that says it is, is noise.
  const worthACard = (r: NewsFormRow) => !r.line.startsWith("steady minutes");

  for (const r of form) {
    if (out.length >= maxForm) break;
    if (!worthACard(r)) continue;
    out.push({
      kind: "form",
      title: `${r.name} is quietly racking up points`,
      body: `${r.points} points for ${r.club} — ${r.line}.`,
    });
  }

  const swings = runs
    .map((r) => ({ r, kind: r.cells.filter((c) => c.difficulty === "kind").length }))
    .filter((x) => x.kind >= 3)
    .sort((a, b) => b.kind - a.kind)
    .slice(0, maxSwings);

  for (const { r, kind } of swings) {
    // Gameweek count, not fixture count — a double gameweek pushes cells.length
    // above the number of GWs on the ticker, which made this read "4 of their
    // next 7" under a 5-GW header.
    const gwCount = new Set(r.cells.map((c) => c.gw)).size;
    out.push({
      kind: "fixture-swing",
      title: `${r.club} have a kind run coming`,
      body: `${kind} of their next ${gwCount} look winnable. A good time to be buying their players.`,
    });
  }

  return out;
}

/** Sum per-GW facts into one human-legible form line. Pure. */
export function formLine(pos: string, agg: MatchFacts, games: number): string {
  const bits: string[] = [];
  if (agg.goals) bits.push(`${agg.goals} goal${agg.goals > 1 ? "s" : ""}`);
  if (agg.assists) bits.push(`${agg.assists} assist${agg.assists > 1 ? "s" : ""}`);
  if ((pos === "GK" || pos === "DEF") && agg.cleanSheet)
    bits.push(`${agg.cleanSheet} clean sheet${agg.cleanSheet > 1 ? "s" : ""}`);
  if (pos === "GK" && agg.saves) bits.push(`${agg.saves} saves`);
  if (bits.length === 0) bits.push("steady minutes");
  return `${bits.join(" + ")} in his last ${games}`;
}

export function aggregateForm(
  scores: { player_id: number; points: number; facts: MatchFacts }[],
  games: number,
  topN = 10,
): NewsFormRow[] {
  const byPlayer = new Map<number, { points: number; facts: MatchFacts; n: number }>();
  for (const s of scores) {
    const cur = byPlayer.get(s.player_id);
    if (!cur) {
      byPlayer.set(s.player_id, { points: s.points, facts: { ...s.facts }, n: 1 });
    } else {
      cur.points += s.points; cur.n += 1;
      for (const k of Object.keys(s.facts) as (keyof MatchFacts)[])
        cur.facts[k] = (cur.facts[k] ?? 0) + (s.facts[k] ?? 0);
    }
  }
  const pool = new Map(fantasyPool().players.map((p) => [p.id, p]));
  const rows: NewsFormRow[] = [];
  byPlayer.forEach((v, playerId) => {
    const p = pool.get(playerId);
    if (p)
      rows.push({
        playerId, name: p.name, club: p.club, pos: p.pos,
        points: v.points, line: formLine(p.pos, v.facts, games),
      });
  });
  return rows.sort((a, b) => b.points - a.points).slice(0, topN);
}

// -------------------------------------------------------- staleness gating

const HOUR = 3_600_000;
const stale = (updatedAt: string | undefined, maxAgeMs: number, now: Date) =>
  !updatedAt || now.getTime() - new Date(updatedAt).getTime() > maxAgeMs;

/** Per-section rebuild rules (spec §3). An EMPTY section is always stale —
 *  a failed/dead-zone fetch self-heals on the next run instead of waiting
 *  out its freshness window. */
export function sectionsToRebuild(doc: NewsDoc | null, deadline: string | null, now: Date) {
  const nearDeadline =
    !!deadline && new Date(deadline).getTime() - now.getTime() < 48 * HOUR;
  return {
    // Optional-chain every section: the doc is PERSISTED JSON that outlives the
    // code that wrote it, so an older-shape doc (or a hand-edited one) must not
    // crash the builder — a missing section just reads as empty, i.e. stale.
    fixtures:
      !doc?.fixtures?.runs?.length || stale(doc.fixtures.updatedAt, 24 * HOUR, now),
    teamNews:
      (!doc?.teamNews?.predicted?.length && !doc?.teamNews?.items?.length) ||
      stale(doc.teamNews.updatedAt, (nearDeadline ? 1 : 24) * HOUR, now),
    form: !doc?.form?.rows?.length || stale(doc.form.updatedAt, 24 * HOUR, now),
    transfers:
      !doc?.transfers?.items?.length || stale(doc.transfers.updatedAt, 1 * HOUR, now),
  };
}

// ------------------------------------------------------------ SM fetchers

const SM = "https://api.sportmonks.com/v3/football";
const key = () => {
  const k = process.env.SPORTMONKS_API_KEY;
  if (!k) throw new Error("SPORTMONKS_API_KEY missing");
  return k;
};

interface SmPage {
  data?: SmFixtureLite[];
  pagination?: { has_more?: boolean; next_page?: string | null };
}

/** A 5-GW window with a double gameweek or a reschedule can exceed a single
 *  50-fixture page — SportMonks doesn't error, it just truncates, so clubs
 *  silently lose cells and difficulty runs get computed on missing data.
 *  Follows pagination.has_more/next_page until exhausted, capped at
 *  MAX_PAGES so a malformed response can't loop forever. */
const MAX_FIXTURE_PAGES = 10;

export async function fetchFixturesWindow(fromISO: string, toISO: string): Promise<SmFixtureLite[]> {
  const out: SmFixtureLite[] = [];
  let url: string | null =
    `${SM}/fixtures/between/${fromISO}/${toISO}?filters=fixtureLeagues:8&include=participants&per_page=50&api_token=${key()}`;

  for (let page = 0; url && page < MAX_FIXTURE_PAGES; page++) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`SM fixtures ${res.status}`);
    const json = (await res.json()) as SmPage;
    out.push(...(json.data ?? []));
    url = json.pagination?.has_more && json.pagination.next_page ? json.pagination.next_page : null;
  }
  return out;
}

/** League position per SM team id from current-season standings. */
export async function fetchStandings(smSeasonId: number): Promise<Map<number, number>> {
  const res = await fetch(
    `${SM}/standings/seasons/${smSeasonId}?api_token=${key()}`,
    { cache: "no-store" },
  );
  if (!res.ok) return new Map(); // pre-season / error → all medium
  const rows = ((await res.json()).data ?? []) as { participant_id?: number; position?: number }[];
  return new Map(rows.filter((r) => r.participant_id && r.position).map((r) => [r.participant_id!, r.position!]));
}

/** Predicted XI per fixture. Include name STILL UNVERIFIED pre-season
 *  (spec §7.1): entitlement "Access Predicted Lineups" is confirmed, but SM
 *  doesn't populate rows until ~24-48h pre-kickoff, so the exact include
 *  couldn't be probed on 2026-07-13 and must be confirmed against a live
 *  fixture before launch. Tries the documented include and degrades to [] on
 *  any error — the hub renders an empty team-news data section until verified
 *  (editorial items still show).
 *
 *  type_id 11 = lineup (starting XI) in SM v3. Rows are required to have it —
 *  an `undefined` fallback here used to count untyped rows (which can include
 *  bench players) as starters, generating false "dropped from XI" doubts. */
export async function fetchPredictedXI(fixtureId: number): Promise<{ smId: number; name: string; teamId: number }[]> {
  try {
    const res = await fetch(
      `${SM}/fixtures/${fixtureId}?include=predictions.type;lineups.player&api_token=${key()}`,
      { cache: "no-store" },
    );
    if (!res.ok) return [];
    const data = (await res.json()).data as {
      lineups?: { player_id: number; player_name?: string; team_id: number; type_id?: number }[];
    };
    return (data.lineups ?? [])
      .filter((l) => l.type_id === 11)
      .map((l) => ({ smId: l.player_id, name: l.player_name ?? `#${l.player_id}`, teamId: l.team_id }));
  } catch {
    return [];
  }
}

/** Drop a captain/differential pick if its player now appears in the current
 *  doubts list. Used when a redraft was triggered by exactly that (the tipped
 *  player got flagged) but the redraft itself failed — leaving the stale pick
 *  on screen would be the bug this exists to prevent. Pure. */
function scrubDoubtfulPicks(tips: NewsDoc["tips"], doubtNamesLower: Set<string>): NewsDoc["tips"] {
  const next = { ...tips };
  if (next.captain && doubtNamesLower.has(next.captain.player.toLowerCase())) delete next.captain;
  if (next.differential && doubtNamesLower.has(next.differential.player.toLowerCase())) delete next.differential;
  return next;
}

// ---------------------------------------------------------------- assembly

export async function buildNewsDoc(
  db: SupabaseClient,
  now = new Date(),
  opts: { force?: boolean } = {},
): Promise<NewsDoc | null> {
  // Current gameweek = earliest non-final GW (matches server.ts convention).
  const { data: gws } = await db
    .from("fantasy_gameweeks")
    .select("gw, deadline, window_start, window_end, sm_season_id, status")
    .neq("status", "final")
    .order("gw")
    .limit(1);
  const gwRow = gws?.[0];
  if (!gwRow) return null;

  const { data: existing } = await db
    .from("fantasy_news_feed").select("doc").eq("gw", gwRow.gw).maybeSingle();
  const prev = (existing?.doc ?? null) as NewsDoc | null;
  const todo = opts.force
    ? { fixtures: true, teamNews: true, form: true, transfers: true }
    : sectionsToRebuild(prev, gwRow.deadline, now);
  const iso = now.toISOString();

  const empty: NewsDoc = {
    gw: gwRow.gw, deadline: gwRow.deadline, builtAt: iso,
    fixtures: { gws: [], runs: [], updatedAt: "" },
    teamNews: { predicted: [], doubts: [], items: [], updatedAt: "" },
    form: { rows: [], updatedAt: "" },
    insights: { items: [], updatedAt: "" },
    transfers: { items: [], updatedAt: "" },
    tips: {},
  };
  // Merge the previous doc over a fresh skeleton, dropping any section whose
  // shape has drifted (e.g. the pre-club-ticker `fixtures.rows`). Without this
  // an old persisted doc silently carries a dead section forever.
  const doc: NewsDoc = !prev ? empty : {
    ...empty,
    ...prev,
    fixtures: Array.isArray(prev.fixtures?.runs) ? prev.fixtures : empty.fixtures,
    teamNews: Array.isArray(prev.teamNews?.items) ? prev.teamNews : empty.teamNews,
    form: Array.isArray(prev.form?.rows) ? prev.form : empty.form,
    insights: Array.isArray(prev.insights?.items) ? prev.insights : empty.insights,
    transfers: Array.isArray(prev.transfers?.items) ? prev.transfers : empty.transfers,
    tips: prev.tips ?? empty.tips,
  };
  doc.builtAt = iso;
  doc.deadline = gwRow.deadline;

  if (todo.fixtures) {
    try {
      // Columns = the next 5 GWs from the fantasy calendar. Bucketing fixtures
      // by GW window (not by raw date) is what lets the ticker be a club × GW
      // grid — the only shape where "tough" has an unambiguous subject.
      const { data: upcoming } = await db
        .from("fantasy_gameweeks")
        .select("gw, window_start, window_end")
        .gte("gw", gwRow.gw).order("gw").limit(5);
      const windows: GwWindow[] = (upcoming ?? []).map((w) => ({
        gw: w.gw as number,
        start: w.window_start as string,
        end: w.window_end as string,
      }));
      if (windows.length) {
        // Anchor to the GW windows themselves, not "today": in replay/demo mode
        // the windows are historical, and pre-season "today +35d" lands in the
        // dead zone before the opening fixtures (both verified live Jul 13).
        const [fixtures, positions] = await Promise.all([
          fetchFixturesWindow(windows[0].start, windows[windows.length - 1].end),
          fetchStandings(gwRow.sm_season_id),
        ]);
        const { gws, runs } = buildClubTicker(fixtures, positions, windows);
        doc.fixtures = { gws, runs, updatedAt: iso };
      }
    } catch { /* keep previous rows */ }
  }

  if (todo.teamNews) {
    const poolSmIds = new Set(fantasyPool().players.map((p) => p.smId));
    const gwFixtures = await fetchFixturesWindow(gwRow.window_start, gwRow.window_end).catch(() => []);
    const predicted: NewsClubXI[] = [];
    const doubts: NewsDoubt[] = [];
    for (const f of gwFixtures) {
      const xi = await fetchPredictedXI(f.id);
      for (const part of f.participants ?? []) {
        const clubXI: NewsClubXI = {
          club: part.name ?? `#${part.id}`, clubId: part.id,
          xi: xi.filter((p) => p.teamId === part.id).map((p) => ({ smId: p.smId, name: p.name })),
        };
        if (clubXI.xi.length === 0) continue;
        predicted.push(clubXI);
        // Baseline = the FIRST snapshot stored for this club in this GW, not
        // the latest — diffing against latest makes a doubt vanish after one
        // cron cycle (see diffPredictedXI doc comment). ascending + limit(1)
        // gets that first snapshot; if none exists yet, this run's insert
        // below BECOMES the baseline and (correctly) produces no doubts.
        const { data: baselineSnap } = await db
          .from("fantasy_predicted_xi").select("xi")
          .eq("gw", gwRow.gw).eq("club_id", part.id)
          .order("fetched_at", { ascending: true }).limit(1);
        doubts.push(...diffPredictedXI(
          baselineSnap?.[0] ? { club: clubXI.club, clubId: part.id, xi: baselineSnap[0].xi } : undefined,
          clubXI, poolSmIds,
        ));
        await db.from("fantasy_predicted_xi")
          .insert({ gw: gwRow.gw, club_id: part.id, xi: clubXI.xi, fetched_at: iso });
      }
    }
    // Filter by TOPIC. Both sections used to read the same untyped table, so
    // every item rendered twice (once under Team news, once under Transfers).
    const { data: items } = await db
      .from("fantasy_news_items").select("kind, payload, created_at")
      .eq("topic", "team-news")
      .order("created_at", { ascending: false }).limit(10);
    doc.teamNews = {
      predicted, doubts,
      items: (items ?? []).map((i) => ({ kind: i.kind, payload: i.payload, createdAt: i.created_at })),
      updatedAt: iso,
    };
  }

  if (todo.form) {
    // Prefer the 5 GWs before the current one; when none exist (GW1, or the
    // replay demo where "current" stays at 1 while scores span 1..30), fall
    // back to the latest 5 scored GWs so the section still has content.
    let lastGw = gwRow.gw - 1;
    if (lastGw < 1) {
      const { data: maxRow } = await db
        .from("fantasy_player_scores").select("gw")
        .order("gw", { ascending: false }).limit(1);
      lastGw = maxRow?.[0]?.gw ?? 0;
    }
    if (lastGw >= 1) {
      const fromGw = Math.max(1, lastGw - 4);
      const { data: scores } = await db
        .from("fantasy_player_scores").select("player_id, points, facts")
        .gte("gw", fromGw).lte("gw", lastGw);
      if (scores?.length)
        doc.form = { rows: aggregateForm(scores, lastGw - fromGw + 1), updatedAt: iso };
    }
  }

  // Insights derive from form + fixtures, so rebuild whenever EITHER moved.
  // They're the feed-native face of our reference data: the ticker and the form
  // table are tools (own tab / data only), these are the cards a fan reads.
  if (todo.form || todo.fixtures) {
    doc.insights = {
      items: buildInsights(doc.form.rows, doc.fixtures.runs),
      updatedAt: iso,
    };
  }

  // Tips: ONCE per gameweek (or on force), not hourly — they're a weekly editorial
  // beat, they cost an LLM call, and re-drafting them every hour would mean the
  // advice silently changed under a user who read it this morning. The one
  // exception: a doubt now naming the tipped captain/differential forces an
  // early redraft — advice that survives its own subject being ruled out is
  // worse than no advice.
  const doubtNamesLower = new Set(doc.teamNews.doubts.map((d) => d.name.toLowerCase()));
  const tippedNames = [doc.tips.captain?.player, doc.tips.differential?.player]
    .filter((n): n is string => !!n)
    .map((n) => n.toLowerCase());
  const tippedPlayerNowDoubtful = tippedNames.some((n) => doubtNamesLower.has(n));

  const tipsStale = !doc.tips.updatedAt || doc.tips.gw !== gwRow.gw || tippedPlayerNowDoubtful;
  if (opts.force || tipsStale) {
    const result = await generateTips({
      gw: gwRow.gw, form: doc.form.rows, runs: doc.fixtures.runs, doubts: doc.teamNews.doubts,
    });
    if (result.tips) {
      doc.tips = { ...result.tips, gw: gwRow.gw, updatedAt: iso, draftedAt: iso };
    } else {
      // A failed redraft (API down, dead key, rejected grounding) must not
      // leave a now-doubtful player as live advice — strip just that pick.
      // Otherwise leave the previous tips in place rather than blanking the
      // section, but always record WHY the redraft failed so it's visible in
      // the cron response instead of silent.
      const kept = tippedPlayerNowDoubtful
        ? scrubDoubtfulPicks(doc.tips, doubtNamesLower)
        : doc.tips;
      doc.tips = { ...kept, issue: result.reason };
    }
  } else if (doc.tips.issue) {
    // Tips are fresh and nothing forced a redraft — clear a stale issue flag
    // left over from an earlier failed attempt.
    doc.tips = { ...doc.tips };
    delete doc.tips.issue;
  }

  if (todo.transfers) {
    // "Transfers & talk" = transfer news + the general football river. NOT
    // team-news (that has its own section) — see the topic filter above.
    const { data: items } = await db
      .from("fantasy_news_items").select("kind, payload, created_at")
      .in("topic", ["transfer", "general"])
      .order("created_at", { ascending: false }).limit(20);
    doc.transfers = {
      items: (items ?? []).map((i) => ({ kind: i.kind, payload: i.payload, createdAt: i.created_at })),
      updatedAt: iso,
    };
  }

  await db.from("fantasy_news_feed").upsert({ gw: gwRow.gw, doc, updated_at: iso });
  return doc;
}
