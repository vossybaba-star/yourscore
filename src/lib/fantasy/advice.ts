/**
 * Fantasy transfer advice — L1 (score) + L2 (solve). Pure, isomorphic, no DB, no
 * fetch, no Date.now(), no randomness — same discipline as engine.ts, and for the
 * same reason: the whole point of this module is that its output is mechanically
 * checkable (scripts/fantasy/run-tests.sh) and safe to import from a "use client"
 * page.
 *
 * HARD RULE: this file may only take `import type` from "./news" — never a value
 * import. "./news" (and "./pool") start with `import "server-only"`, which THROWS
 * at runtime outside a server/RSC context. `src/app/fantasy/transfers/page.tsx` is
 * a client component, so a value import here would break it. Everything this
 * module needs (Squad, PoolPlayer[], form rows, fixture runs) is passed in as
 * plain data by the caller — exactly how transfers/page.tsx already holds
 * `pool`/`form`/`state` in useState today.
 *
 * L3 (the LLM judgement layer) lives in tips.ts, not here — this module never
 * computes prose, never calls a model, and never decides what to SAY, only what
 * is legal and how good it looks by a legible heuristic.
 */
import type { Squad, FantasyPos } from "./engine";
import type { Difficulty, NewsDoubt, NewsTickerCell } from "./news";

export type FplStatus = "a" | "d" | "i" | "s" | "u";
export interface AvailabilityInfo { status: FplStatus; chance: number | null; news: string }

/** Pure interpretation of FPL availability rows into a lookup the filters use.
 *  Returns null (no-availability mode) when there are no rows at all, which is
 *  what makes "FPL told us nobody is injured" and "we could not read FPL"
 *  distinguishable — the caller degrades to no hard filter rather than to a
 *  clean bill of health.
 *
 *  EPOCH. This used to take a season string and drop any row whose `fpl_season`
 *  didn't match, because its source (`fantasy_player_status`) accumulated rows
 *  across seasons and FPL served last season's for weeks. That table is gone
 *  (migration 219 — it was a second source of truth for one fact). Availability
 *  now comes from `fantasy_fpl_snapshot`, which is immutable and keyed on
 *  `captured_at`, so the epoch guard moved to the READ: the caller selects the
 *  single newest `captured_at` for the right `is_rehearsal` and passes only
 *  those rows. There is no stale-season row to filter here because there is no
 *  mixed-epoch table to read from — which is why this no longer takes a season.
 *
 *  `status` is FPL's own letter, passed through rather than re-derived: 'a'
 *  available, 'd' doubtful, 'i' injured, 's' suspended, 'u' unavailable. A row
 *  with an unrecognised status is treated as unavailable-unknown ('u') rather
 *  than silently as available — the safe direction for a fact we cannot read. */
export function resolveAvailability(
  rows: { playerId: number; status: string | null; chance: number | null; news: string | null }[],
  ): Map<number, AvailabilityInfo> | null {
  if (!rows.length) return null;
  const known: FplStatus[] = ["a", "d", "i", "s", "u"];
  return new Map(rows.map((r) => {
    const s = (r.status ?? "").trim().toLowerCase();
    const status = (known as string[]).includes(s) ? (s as FplStatus) : "u";
    return [r.playerId, { status, chance: r.chance, news: r.news ?? "" }];
  }));
}

/** Doubts from FPL's own availability feed — the REAL source, replacing an
 *  inference that never fired.
 *
 *  `diffPredictedXI` above infers a doubt from a player vanishing between two
 *  predicted-XI snapshots. Measured 2026-07-22: that inference is dead and has
 *  probably always been. Our SportMonks plan 403s the `expectedLineups`
 *  include (still, even after the odds licence upgrade), and the `lineups`
 *  include only populates AFTER kickoff — eight genuinely upcoming fixtures
 *  returned zero lineup rows each. `fetchPredictedXI` swallows that into `[]`,
 *  `buildNewsDoc` skips a club whose XI is empty, and the section renders
 *  empty. No error anywhere: "no injuries this week" and "this feature does
 *  not work" look identical.
 *
 *  `fantasy_fpl_snapshot` (migration 210) already carries FPL's own per-player
 *  `status`, `chance_of_playing_next_round` and a human-readable `news` string
 *  ("Knee injury - Expected back 01 Apr"). It's free, it's keyed on our exact
 *  pool ids (FPL element id = YourScore pool id), and it's a stated fact rather
 *  than a guess — which also means the grounded tips layer can finally SAY
 *  "injury" honestly, because it can cite it.
 *
 *  This is the ONE owning source for the fact. An earlier build had a second
 *  table (`fantasy_player_status`) carrying the same three columns from the same
 *  upstream feed; migration 219 dropped it. Two sources for one fact is the
 *  exact shape of bug this codebase keeps shipping — do not add a third.
 *
 *  Only pool players are flagged (others are noise), and only a player FPL
 *  says isn't fully available. Pure. */
export function doubtsFromAvailability(
  rows: { playerId: number; status: string; chance: number | null; news: string }[],
  pool: { id: number; smId: number | null; name: string; club: string }[],
): NewsDoubt[] {
  const byId = new Map(pool.map((p) => [p.id, p]));
  const out: NewsDoubt[] = [];
  for (const r of rows) {
    if (r.status === "a") continue; // available — nothing to say
    const p = byId.get(r.playerId);
    if (!p || p.smId === null) continue;
    // FPL's own words when it gives them; a plain status phrase when it
    // doesn't. Never invent a cause — an unexplained doubt still says only
    // what we can defend.
    const reason = r.news.trim()
      || (r.status === "s" ? "suspended"
        : r.status === "i" ? "injured"
        : r.status === "d" ? (r.chance !== null ? `${r.chance}% chance of playing` : "a doubt")
        : "unavailable");
    out.push({ smId: p.smId, name: p.name, club: p.club, reason });
  }
  return out;
}

// ── Flagging YOUR players ────────────────────────────────────────────────────
/**
 * Availability has only ever been a filter on who you may BUY. Nothing looked
 * at the fifteen you already own and said "he isn't playing Saturday, move him
 * on" — which is the single most useful thing a transfer tool can tell a
 * manager, and the thing they most often miss because it happens on a Thursday
 * when they aren't looking.
 *
 * TWO INDEPENDENT SIGNALS, deliberately kept apart rather than blended into a
 * score. A manager can act on "injured" and on "hasn't played in a fortnight";
 * they cannot act on 0.73.
 *
 *  1. FPL's own status feed — authoritative, and it knows BEFORE he misses a
 *     game ("Knee injury - Expected back 01 Apr"). It is live-only: there is no
 *     historical archive of it, so this signal cannot be backtested.
 *  2. No minutes in the recent past — weaker and slower, because it only knows
 *     once he has already sat out. But it is derivable from history, which
 *     makes it the one we CAN measure, and it catches a case the status feed
 *     never reports at all: the perfectly fit player who has simply lost his
 *     place.
 *
 * So what ships is a superset of what we can prove. Whatever the backtest says
 * signal 2 is worth is a FLOOR on the pair, which is the honest direction for
 * an unverifiable claim to err in.
 */
export type FlagKind = "out" | "doubt" | "benched";
export interface SquadFlag {
  playerId: number;
  kind: FlagKind;
  /** `high` — he is very unlikely to play. `medium` — worth a look, not a panic. */
  severity: "high" | "medium";
  /** FPL's own words where it has them, a plain phrase where it doesn't.
   *  Never a cause we inferred — an unexplained doubt says only what we can
   *  defend, same rule `doubtsFromAvailability` already follows. */
  reason: string;
}

// ── Squad Update DTO (Scout Briefing) ────────────────────────────────────────
/** One factual note about a player a manager ALREADY owns, for the personalised
 *  head of the Scout Briefing. Lives here (client-safe types module) so the
 *  server route that builds it and the client card that renders it share ONE
 *  definition and can never drift.
 *
 *  Statuses are categories, never advice: the red ones (Injured/Suspended) and
 *  amber (Doubt) come from FPL's own availability feed; No fixture comes from the
 *  fixture ticker. Green (Returning/Favourable fixture) are reserved for later
 *  stages — kept in the union so the colour system is complete. */
export type SquadUpdateStatus =
  | "Injured" | "Suspended" | "Doubt" | "Returning" | "No fixture" | "Favourable fixture";
export interface SquadUpdateItem {
  playerId: number;
  name: string;
  club: string;
  position: FantasyPos;
  status: SquadUpdateStatus;
  /** FPL's own words where it has them, a plain factual phrase where it doesn't.
   *  Never a cause we inferred — same rule the doubts feed already follows. */
  explanation: string;
  /** e.g. "vs ARS" / "@ MCI", or null when there is no next fixture in range. */
  nextFixture: string | null;
}

/** Gameweeks of zero minutes before we call someone benched. Two, because one
 *  is a rest, a knock, or a rotation for a cup tie — normal football, and
 *  flagging it would make the tool cry wolf every single week. */
export const BENCH_WINDOW_GWS = 2;

export function flagSquad(args: {
  squad: Squad;
  /** null in no-availability/degrade mode — the minutes signal still works. */
  availability: Map<number, AvailabilityInfo> | null;
  /** playerId -> minutes per gameweek, MOST RECENT LAST. A player absent from
   *  this map has no history and is never flagged as benched: a new signing has
   *  not failed to play, he has not had the chance. */
  recentMinutes?: Map<number, number[]>;
}): SquadFlag[] {
  const { squad, availability, recentMinutes } = args;
  const flags: SquadFlag[] = [];

  for (const pick of squad.picks) {
    const av = availability?.get(pick.id);
    const news = av?.news?.trim() ?? "";

    if (av && (av.status === "i" || av.status === "s" || av.status === "u")) {
      flags.push({
        playerId: pick.id, kind: "out", severity: "high",
        reason: news || (av.status === "s" ? "suspended" : av.status === "i" ? "injured" : "unavailable"),
      });
      continue;
    }

    if (av && av.status === "d") {
      // FPL's chance is 0/25/50/75/100. At half or less he is more likely to
      // miss than play, which is a different message from "keep an eye on him".
      const bad = av.chance !== null && av.chance <= 50;
      flags.push({
        playerId: pick.id, kind: "doubt", severity: bad ? "high" : "medium",
        reason: news || (av.chance !== null ? `${av.chance}% chance of playing` : "a doubt"),
      });
      continue;
    }

    // No status concern — but has he actually been playing? Only ask when we
    // have a full window of history for him, so a mid-season arrival with one
    // recorded gameweek is never called benched on a sample of one.
    const mins = recentMinutes?.get(pick.id);
    if (mins && mins.length >= BENCH_WINDOW_GWS) {
      const window = mins.slice(-BENCH_WINDOW_GWS);
      if (window.every((m) => m === 0)) {
        flags.push({
          playerId: pick.id, kind: "benched", severity: "medium",
          reason: `hasn't played in ${BENCH_WINDOW_GWS} gameweeks`,
        });
      }
    }
  }

  // Worst first: a manager scanning this should hit the player who definitely
  // isn't playing before the one who might not.
  const rank = (f: SquadFlag) =>
    (f.severity === "high" ? 0 : 10) + (f.kind === "out" ? 0 : f.kind === "doubt" ? 1 : 2);
  return flags.sort((a, b) => rank(a) - rank(b) || a.playerId - b.playerId);
}

// ── DB-read honesty (defect F6) ──────────────────────────────────────────────
/** supabase-js RETURNS a read failure on `.error`, it does NOT throw — a
 *  transient failure silently produces `data: null` (or an empty array for a
 *  list query), which a caller that destructures only `.data` can mistake for
 *  "genuinely nothing there" and degrade into treating a bad read as a good,
 *  empty one. F6: exactly this, on `fantasy_player_scores`, turned a
 *  transient read failure into an all-zero history, which the projection
 *  layer then reported as a real, healthy projection (`projectionUsed:
 *  true`), silently replacing perfectly good `scorePool` numbers with
 *  near-zero ones.
 *
 *  Every DB read in the cron route should go through this instead of
 *  destructuring `.data` alone: an error always throws (into the caller's own
 *  try/catch degrade path — this function never decides what "degrade" means,
 *  only that a failure is never silently indistinguishable from an empty
 *  success). `data` is allowed to be null on SUCCESS too (`.maybeSingle()`
 *  with no matching row) — only `.error` being set throws. Pure, no DB —
 *  trivially unit-testable with a fake result object. */
export function unwrapRead<T>(
  result: { data: T | null; error: { message: string } | null },
  context: string,
): T | null {
  if (result.error) throw new Error(`${context}: ${result.error.message}`);
  return result.data;
}

// ── Player profile — the six questions a manager actually asks ───────────────
/**
 * What to show someone deciding whether to keep or sell a player.
 *
 * THE PRODUCT TURN (founder, 24 Jul 2026): this tool does not tell you what to
 * do. It gives you the arguments and you decide. That is a weaker-sounding
 * claim and a much stronger one — we could never prove our picks beat a real
 * manager's, but every number here is checkable, and the ones a hidden ranking
 * couldn't use are exactly the ones that read well as a sentence. xG added
 * almost nothing as a silent input and is the single most useful line on this
 * screen.
 *
 * WHAT MATTERS DEPENDS ON POSITION, and we don't guess at that — we read it off
 * the scoring table. A clean sheet pays a defender 4 and a forward 0, so a
 * forward's profile never mentions one. Saves pay only a keeper. Defensive
 * contribution pays everyone but keepers, who aren't eligible. Ordering each
 * profile by what actually scores that position is the whole rule.
 */
export interface ProfileStat {
  /** Short label, e.g. "Clean sheets". */
  label: string;
  /** The number as a display string — the caller never formats. */
  value: string;
  /** One line of plain-English reading, or null to show the number bare.
   *  Mechanical, never a model: a clear margin either way gets a sentence, a
   *  close call gets silence. A user can redo the arithmetic themselves. */
  note: string | null;
}

/** Last season's real totals (from FPL bootstrap, whose season stats are the
 *  PREVIOUS season's until FPL resets them pre-season). Shown, clearly labelled,
 *  so a player has something real to judge before GW1 has any current data. */
export interface LastSeasonLine {
  label: string;        // e.g. "2024/25"
  points: number; minutes: number; goals: number; assists: number; starts: number;
  perStart: number | null;
}
/** FPL's own forward look for the coming gameweek — a projection, not a stat. */
export interface Projection {
  epNext: number | null;      // FPL's projected points for the next GW
  form: number | null;
  ownership: number | null;
  available: boolean; chance: number | null; news: string | null;
}

export interface PlayerProfile {
  playerId: number;
  pos: FantasyPos;
  /** True before the player has any current-season appearance: the profile then
   *  leans on `lastSeason` + `projection` instead of the empty per-GW rows. */
  preseason: boolean;
  /** Minutes per gameweek, oldest first — the "is he playing" row. */
  minutes: number[];
  /** Points per gameweek, oldest first — the "is he delivering" row. */
  points: number[];
  seasonPoints: number;
  /** Points per gameweek he actually appeared in. Null if he never played:
   *  dividing by games-played is the whole reason the season-average ranking
   *  was wrong, so a player with no appearances gets no rate, not a zero. */
  perGame: number | null;
  flag: SquadFlag | null;
  /** Position-appropriate, most valuable first. */
  stats: ProfileStat[];
  /** Populated pre-season only: last season's real totals, clearly labelled. */
  lastSeason: LastSeasonLine | null;
  /** FPL's forward projection + availability, shown pre-season. */
  projection: Projection | null;
  fixtures: { gw: number; oppShort: string; home: boolean; difficulty: Difficulty }[];
}

/** Totals for one whole season — enough to build THE CASE without per-GW rows. */
export interface SeasonTotals {
  points: number; minutes: number; starts: number;
  goals: number; assists: number; cleanSheets: number; saves: number; conceded: number;
}

/** THE CASE, built from last season's totals (pre-season). Mirrors the in-season
 *  stat semantics but the denominator is `starts` and every line is a real
 *  last-season number — no projection dressed up as a record, no invented data. */
function statsFromTotals(pos: FantasyPos, t: SeasonTotals): ProfileStat[] {
  const n = t.starts;
  const rate = (x: number) => (n ? x / n : 0);
  const out: ProfileStat[] = [];
  const attack: ProfileStat = { label: "Goals and assists", value: `${t.goals}G ${t.assists}A`, note: null };
  const cs: ProfileStat = {
    label: "Clean sheets",
    value: n ? `${t.cleanSheets} in ${n} starts` : "no starts last season",
    note: n >= 5 && rate(t.cleanSheets) >= 0.4 ? "kept them out more often than not"
      : n >= 5 && t.cleanSheets === 0 ? "none last season — points came from elsewhere" : null,
  };
  if (pos === "GK") {
    out.push(cs);
    out.push({
      label: "Saves", value: n ? `${t.saves} (${rate(t.saves).toFixed(1)} a start)` : "no starts last season",
      note: n >= 5 && rate(t.saves) >= 3 ? "busy enough to score on saves alone" : null,
    });
    out.push({ label: "Goals conceded", value: `${t.conceded}`, note: null });
  } else if (pos === "DEF") {
    out.push(cs); out.push(attack);
  } else {
    out.push(attack);
    if (pos === "MID") out.push(cs);
  }
  return out;
}

/** Facts for one gameweek, as stored. */
export interface ProfileGw { gw: number; facts: MatchFactsLike; points: number }
/** Structurally what values.ts MatchFacts is; declared here so this module
 *  keeps taking plain data and never value-imports the scoring engine. */
export interface MatchFactsLike {
  minutes: number; goals: number; assists: number; cleanSheet: number;
  conceded: number; saves: number; pensSaved: number; pensMissed: number;
  yellows: number; reds: number; ownGoals: number; dc: number; dcRec: number;
}

const sum = (rows: ProfileGw[], pick: (f: MatchFactsLike) => number) =>
  rows.reduce((s, r) => s + pick(r.facts), 0);

/** Games he actually appeared in — the correct denominator for any rate. */
const appearances = (rows: ProfileGw[]) => rows.filter((r) => r.facts.minutes > 0).length;

export function buildPlayerProfile(args: {
  playerId: number;
  pos: FantasyPos;
  /** Recent gameweeks, OLDEST FIRST. */
  recent: ProfileGw[];
  /** Whole-season rows for rate stats; defaults to `recent`. */
  season?: ProfileGw[];
  /** Expected goals across `season`, when we have it. */
  xg?: number | null;
  flag?: SquadFlag | null;
  fixtures?: NewsTickerCell[];
  /** Last season's totals — used to build the profile before GW1 has any data. */
  lastSeasonTotals?: SeasonTotals | null;
  lastSeasonLabel?: string;
  projection?: Projection | null;
}): PlayerProfile {
  const { playerId, pos, recent, flag = null, fixtures = [] } = args;
  const season = args.season ?? recent;
  const apps = appearances(season);
  const seasonPoints = season.reduce((s, r) => s + r.points, 0);
  const fixtureCells = fixtures.map((c) => ({
    gw: c.gw, oppShort: c.oppShort, home: c.home, difficulty: c.difficulty,
  }));

  // Pre-season: no current appearance yet. Lean on last season's real totals
  // (labelled) + FPL's projection, instead of a row of zeroes reading "no games
  // yet". Once a current-season appearance exists this branch is skipped.
  if (apps === 0 && args.lastSeasonTotals) {
    const t = args.lastSeasonTotals;
    return {
      playerId, pos, preseason: true,
      minutes: [], points: [],
      seasonPoints: t.points,
      perGame: t.starts ? Math.round((t.points / t.starts) * 10) / 10 : null,
      flag,
      stats: statsFromTotals(pos, t),
      lastSeason: {
        label: args.lastSeasonLabel ?? "last season",
        points: t.points, minutes: t.minutes, goals: t.goals, assists: t.assists,
        starts: t.starts, perStart: t.starts ? Math.round((t.points / t.starts) * 10) / 10 : null,
      },
      projection: args.projection ?? null,
      fixtures: fixtureCells,
    };
  }

  const stats: ProfileStat[] = [];
  const goals = sum(season, (f) => f.goals);
  const assists = sum(season, (f) => f.assists);
  const xg = args.xg ?? null;

  // "Due, or finished" — goals against the chances he got. The most useful
  // line we have, and only meaningful for players who are supposed to score.
  const dueOrFinished = (): ProfileStat | null => {
    if (xg === null || apps === 0) return null;
    const diff = goals - xg;
    // A margin of one goal is the threshold: below that it is noise over a
    // handful of games, and saying something either way would be false
    // precision dressed up as insight.
    const note = diff <= -1 ? "getting chances, not taking them"
      : diff >= 1 ? "scoring more than his chances suggest"
      : null;
    return { label: "Goals vs expected", value: `${goals} from ${xg.toFixed(1)} expected`, note };
  };

  const cs = season.filter((r) => r.facts.minutes >= 60 && r.facts.cleanSheet > 0).length;
  const dcHits = season.filter((r) =>
    pos === "DEF" ? r.facts.dc >= 10 : pos !== "GK" && r.facts.dcRec >= 12).length;
  const conceded = sum(season, (f) => f.conceded);
  const saves = sum(season, (f) => f.saves);

  const csStat = (): ProfileStat => ({
    label: "Clean sheets",
    value: apps ? `${cs} in ${apps} games` : "no games yet",
    note: apps >= 3 && cs / apps >= 0.4 ? "keeps them out more often than not"
      : apps >= 3 && cs === 0 ? "none yet — his points have to come from elsewhere"
      : null,
  });
  const dcStat = (): ProfileStat => ({
    label: "Defensive returns",
    value: apps ? `${dcHits} in ${apps} games` : "no games yet",
    // NO POINTS FIGURE IN THIS STRING. A scoring value quoted in prose is
    // exactly how the scale-mismatch bugs in this codebase keep happening: this
    // once read "reliable 2 points", a hardcoded award that was wrong whenever
    // the table and the copy drifted apart. Stating the fact without the figure
    // is true regardless of the scale in values.ts. If a number is ever wanted
    // here it must be read from values.ts, never typed out.
    note: apps >= 3 && dcHits / apps >= 0.5 ? "reliable returns even without a clean sheet" : null,
  });
  const attackStat = (): ProfileStat => ({
    label: "Goals and assists", value: `${goals}G ${assists}A`, note: null,
  });

  if (pos === "GK") {
    // No xG line: keepers do not shoot, and a goal is not part of the case for
    // owning one. Saves are, because every third save pays out (see values.ts
    // for the amount — deliberately not repeated here, it is scale-dependent).
    stats.push(csStat());
    stats.push({
      label: "Saves", value: apps ? `${saves} (${(saves / apps).toFixed(1)} a game)` : "no games yet",
      note: apps >= 3 && saves / apps >= 3 ? "busy enough to score on saves alone" : null,
    });
    stats.push({ label: "Goals conceded", value: `${conceded}`, note: null });
  } else if (pos === "DEF") {
    stats.push(csStat());
    stats.push(dcStat());
    stats.push(attackStat());
    const d = dueOrFinished();
    if (d) stats.push(d);
  } else if (pos === "MID") {
    stats.push(attackStat());
    const d = dueOrFinished();
    if (d) stats.push(d);
    stats.push(dcStat());
    stats.push(csStat());
  } else {
    // Forward: a clean sheet pays him nothing, so it is never mentioned.
    stats.push(attackStat());
    const d = dueOrFinished();
    if (d) stats.push(d);
    stats.push(dcStat());
  }

  return {
    playerId, pos, preseason: false,
    minutes: recent.map((r) => r.facts.minutes),
    points: recent.map((r) => r.points),
    seasonPoints,
    perGame: apps ? Math.round((seasonPoints / apps) * 10) / 10 : null,
    flag,
    stats,
    lastSeason: null,
    projection: args.projection ?? null,
    fixtures: fixtureCells,
  };
}
